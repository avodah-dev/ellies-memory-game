import type { FastifyInstance } from "fastify";
import { isIP } from "node:net";

export type IngestFetch = (url: URL, options: RequestInit) => Promise<Response>;
const INGEST_ORIGIN = "https://us.i.posthog.com";
const ASSETS_ORIGIN = "https://us-assets.i.posthog.com";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const STRIPPED_HEADERS = new Set([
	"set-cookie",
	"content-encoding",
	"content-length",
	"connection",
	"transfer-encoding",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"upgrade",
]);

async function readBoundedBody(response: Response): Promise<Buffer> {
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return Buffer.concat(chunks, bytes);
			bytes += value.byteLength;
			if (bytes > MAX_RESPONSE_BYTES) {
				// Count decoded bytes, never trust compressed/missing Content-Length.
				void reader.cancel().catch(() => {});
				throw new Error("Upstream response limit exceeded");
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
}

function targetFor(rawUrl: string): URL {
	const incoming = new URL(rawUrl, "http://matchimus.invalid");
	if (!incoming.pathname.startsWith("/ingest/"))
		throw new Error("Invalid path");
	const path = incoming.pathname.slice("/ingest".length);
	const decoded = decodeURIComponent(path);
	if (decoded.startsWith("//") || decoded.includes("\\"))
		throw new Error("Invalid path");
	const origin =
		path.startsWith("/static/") || path.startsWith("/array/")
			? ASSETS_ORIGIN
			: INGEST_ORIGIN;
	const target = new URL(path + incoming.search, origin);
	if (target.origin !== origin) throw new Error("Invalid origin");
	return target;
}

// Process-local limits bound public-proxy work without parsing SDK bodies.
// Fly supplies fly-client-ip; direct connections are grouped by socket address.
export function createIngestLimiter() {
	const clients = new Map<string, { tokens: number; at: number }>();
	let sweptAt = 0;
	return (ip: string, now = Date.now()) => {
		if (now - sweptAt > 60000) {
			for (const [key, value] of clients)
				if (now - value.at > 120000) clients.delete(key);
			sweptAt = now;
		}
		let client = clients.get(ip);
		if (!client) {
			if (clients.size >= 4096) return false;
			client = { tokens: 60, at: now };
			clients.set(ip, client);
		}
		client.tokens = Math.min(
			60,
			client.tokens + (Math.max(0, now - client.at) * 4) / 1000,
		);
		client.at = now;
		if (client.tokens < 1) return false;
		client.tokens--;
		return true;
	};
}

export function registerIngestProxy(
	app: FastifyInstance,
	fetchUpstream: IngestFetch = fetch,
) {
	return app.register(async (proxy) => {
		const allow = createIngestLimiter();
		let active = 0;
		proxy.addHook("onRequest", async (request, reply) => {
			const flyIp = request.headers["fly-client-ip"];
			const ip = typeof flyIp === "string" && isIP(flyIp) ? flyIp : request.ip;
			if (!allow(ip)) return reply.header("retry-after", "1").code(429).send();
		});
		// Replace inherited JSON/text parsers only in this plugin. Compressed SDK
		// payloads (including text/plain gzip bytes) must reach PostHog unchanged.
		proxy.removeAllContentTypeParsers();
		proxy.addContentTypeParser(
			"*",
			{ parseAs: "buffer" },
			(_request, body, done) => done(null, body),
		);
		proxy.route({
			method: ["GET", "POST"],
			exposeHeadRoute: false,
			url: "/ingest/*",
			bodyLimit: 1024 * 1024,
			handler: async (request, reply) => {
				let target: URL;
				try {
					target = targetFor(request.raw.url ?? request.url);
				} catch {
					return reply.code(400).send();
				}
				if (active >= 16)
					return reply.header("retry-after", "1").code(429).send();
				const headers = new Headers();
				for (const name of ["content-type", "user-agent", "accept"]) {
					const value = request.headers[name];
					if (typeof value === "string") headers.set(name, value);
				}
				if (request.method === "GET" && target.origin === ASSETS_ORIGIN) {
					for (const name of ["if-none-match", "if-modified-since"]) {
						const value = request.headers[name];
						if (typeof value === "string") headers.set(name, value);
					}
				}
				const clientIp = request.headers["fly-client-ip"];
				if (typeof clientIp === "string" && isIP(clientIp))
					headers.set("x-forwarded-for", clientIp);
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 10000);
				try {
					active++;
					const upstream = await fetchUpstream(target, {
						method: request.method,
						headers,
						body:
							request.method === "POST"
								? (request.body as Buffer | undefined)
								: undefined,
						signal: controller.signal,
						redirect: "error",
					});
					if (
						upstream.redirected ||
						(upstream.status >= 300 &&
							upstream.status < 400 &&
							upstream.status !== 304)
					)
						throw new Error("Upstream redirect rejected");
					const body = await readBoundedBody(upstream);
					const connectionHeaders = new Set(
						(upstream.headers.get("connection") ?? "")
							.toLowerCase()
							.split(",")
							.map((name) => name.trim()),
					);
					upstream.headers.forEach((value, name) => {
						if (!STRIPPED_HEADERS.has(name) && !connectionHeaders.has(name))
							reply.header(name, value);
					});
					return reply.code(upstream.status).send(body);
				} catch {
					controller.abort();
					// Do not log bodies, tokens, request URLs, or upstream error text.
					request.log.warn("PostHog upstream request failed");
					return reply.code(502).send();
				} finally {
					active--;
					clearTimeout(timeout);
				}
			},
		});
	});
}
