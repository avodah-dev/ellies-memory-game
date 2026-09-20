import type { FastifyInstance } from "fastify";
import { isIP } from "node:net";

export type IngestFetch = (url: URL, options: RequestInit) => Promise<Response>;
const INGEST_ORIGIN = "https://us.i.posthog.com";
const ASSETS_ORIGIN = "https://us-assets.i.posthog.com";
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

export function registerIngestProxy(
	app: FastifyInstance,
	fetchUpstream: IngestFetch = fetch,
) {
	return app.register(async (proxy) => {
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
				const headers = new Headers();
				for (const name of ["content-type", "user-agent", "accept"]) {
					const value = request.headers[name];
					if (typeof value === "string") headers.set(name, value);
				}
				const clientIp = request.headers["fly-client-ip"];
				if (typeof clientIp === "string" && isIP(clientIp))
					headers.set("x-forwarded-for", clientIp);
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 10000);
				try {
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
					const body = Buffer.from(await upstream.arrayBuffer());
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
					// Do not log bodies, tokens, request URLs, or upstream error text.
					request.log.warn("PostHog upstream request failed");
					return reply.code(502).send();
				} finally {
					clearTimeout(timeout);
				}
			},
		});
	});
}
