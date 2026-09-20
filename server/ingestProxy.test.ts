import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";
import { createServer, configFromEnvironment } from "./app";
import type { RuntimeConfig } from "../shared/runtimeConfig";
import type { IngestFetch } from "./ingestProxy";

const firebase = {
	projectId: "test-project",
	apiKey: "test-public-key",
	databaseURL: "https://test-project.firebaseio.com",
};
let root: string;
let servers: FastifyInstance[];
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "matchimus-ingest-"));
	await writeFile(
		join(root, "index.html"),
		"<!doctype html><title>Matchimus</title>",
	);
	servers = [];
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.useRealTimers();
	await Promise.all(servers.map((server) => server.close()));
	await rm(root, { recursive: true, force: true });
});
async function serverWith(
	ingestFetch: IngestFetch,
	config: RuntimeConfig = { environment: "preview", telemetry: "on", firebase },
) {
	const server = await createServer({
		root,
		config,
		commit: "test",
		ingestFetch,
	});
	servers.push(server);
	await server.ready();
	return server;
}

describe("telemetry configuration and ping", () => {
	it.each(["preview", "production"])(
		"requires an explicit valid setting in %s",
		(environment) => {
			for (const setting of [undefined, "", "true", "ON", "disabled"]) {
				expect(() =>
					configFromEnvironment({
						APP_ENV: environment,
						APP_TELEMETRY: setting,
						FIREBASE_CONFIG_JSON: JSON.stringify(firebase),
					}),
				).toThrow("Hosted telemetry");
			}
			for (const telemetry of ["on", "off"])
				expect(
					configFromEnvironment({
						APP_ENV: environment,
						APP_TELEMETRY: telemetry,
						FIREBASE_CONFIG_JSON: JSON.stringify(firebase),
					}),
				).toEqual({ environment, telemetry, firebase });
		},
	);
	it("selects explicit local diagnostics independently of hosted environment variables", () => {
		expect(
			configFromEnvironment({
				APP_ENV: "emulator",
				APP_TELEMETRY: "on",
				FIREBASE_CONFIG_JSON: "invalid",
			}),
		).toEqual({ environment: "emulator", telemetry: "on", firebase: null });
	});
	it.each([
		{ environment: "emulator", telemetry: "on", firebase: null },
		{ environment: "emulator", telemetry: "off", firebase: null },
		{ environment: "preview", telemetry: "off", firebase },
		{ environment: "production", telemetry: "off", firebase },
	] satisfies RuntimeConfig[])(
		"never calls upstream when disabled: $environment/$telemetry",
		async (config) => {
			const upstream = vi.fn<IngestFetch>();
			const server = await serverWith(upstream, config);
			for (const path of [
				"/ingest/batch/",
				"/ingest/static/array.js",
				"/ingest/array/config",
				"/ingest/i/v0/e/",
			]) {
				for (const method of ["GET", "POST"] as const)
					expect((await server.inject({ method, url: path })).statusCode).toBe(
						404,
					);
			}
			const before = Date.now();
			const ping = await server.inject("/diag/ping");
			expect(ping.statusCode).toBe(200);
			expect(ping.headers["cache-control"]).toBe("no-store");
			expect(ping.json().now).toBeGreaterThanOrEqual(before);
			expect(ping.json().now).toBeLessThanOrEqual(Date.now());
			expect(upstream).not.toHaveBeenCalled();
		},
	);
});

describe("PostHog proxy", () => {
	it.each(["preview", "production"] as const)(
		"forwards exact JSON bytes and only allowed headers in %s",
		async (environment) => {
			const upstream = vi.fn<IngestFetch>().mockResolvedValue(
				new Response('{"status":1}', {
					headers: {
						"content-type": "application/json",
						"set-cookie": "upstream=private",
						"content-encoding": "gzip",
						"content-length": "999",
						connection: "keep-alive, x-private-hop",
						"x-private-hop": "private",
						"cache-control": "no-store",
					},
				}),
			);
			const server = await serverWith(upstream, {
				environment,
				telemetry: "on",
				firebase,
			});
			const payload = Buffer.from(
				'{ "batch": [], "api_key": "test-project-token" }\n',
			);
			const response = await server.inject({
				method: "POST",
				url: "/ingest/batch/?v=1&data=a%2Bb",
				payload,
				headers: {
					"content-type": "application/json",
					accept: "application/json",
					"user-agent": "test-browser",
					"fly-client-ip": "203.0.113.7",
					"x-forwarded-for": "spoofed",
					cookie: "private=cookie",
					authorization: "Bearer private",
					"x-private-header": "private",
				},
			});
			expect(response.statusCode).toBe(200);
			expect(response.json()).toEqual({ status: 1 });
			const [url, options] = upstream.mock.calls[0];
			expect(url.href).toBe("https://us.i.posthog.com/batch/?v=1&data=a%2Bb");
			expect(options.method).toBe("POST");
			expect(options.body).toEqual(payload);
			expect(options.redirect).toBe("error");
			expect(Object.fromEntries(new Headers(options.headers))).toEqual({
				"content-type": "application/json",
				accept: "application/json",
				"user-agent": "test-browser",
				"x-forwarded-for": "203.0.113.7",
			});
			expect(response.headers["set-cookie"]).toBeUndefined();
			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.headers["x-private-hop"]).toBeUndefined();
			expect(Number(response.headers["content-length"])).toBe(
				Buffer.byteLength(response.body),
			);
			expect(response.headers["cache-control"]).toBe("no-store");
			// Proxy parser changes must not disturb the app's own endpoints.
			expect((await server.inject("/app-config.json")).json()).toEqual({
				environment,
				telemetry: "on",
				firebase,
			});
		},
	);
	it("preserves compressed SDK bytes, not a decoded text string", async () => {
		const upstream = vi.fn<IngestFetch>().mockResolvedValue(new Response("ok"));
		const server = await serverWith(upstream);
		const payload = gzipSync(Buffer.from('[{"event":"$autocapture"}]'));
		expect(
			(
				await server.inject({
					method: "POST",
					url: "/ingest/i/v0/e/?compression=gzip-js",
					headers: { "content-type": "text/plain" },
					payload,
				})
			).statusCode,
		).toBe(200);
		expect(upstream.mock.calls[0][1].body).toEqual(payload);
	});
	it.each([
		[
			"/ingest/static/array.js?v=1",
			"https://us-assets.i.posthog.com/static/array.js?v=1",
		],
		[
			"/ingest/array/token/config",
			"https://us-assets.i.posthog.com/array/token/config",
		],
		["/ingest/flags/?v=2", "https://us.i.posthog.com/flags/?v=2"],
	])("routes GET %s without inventing an IP", async (path, target) => {
		const upstream = vi.fn<IngestFetch>().mockResolvedValue(
			new Response("asset", {
				headers: {
					"content-type": "text/javascript",
					"cache-control": "public, max-age=60",
				},
			}),
		);
		const server = await serverWith(upstream);
		const response = await server.inject({
			url: path,
			headers: { "x-forwarded-for": "spoofed", "fly-client-ip": "invalid, ip" },
		});
		expect(response.statusCode).toBe(200);
		expect(response.body).toBe("asset");
		expect(response.headers["cache-control"]).toBe("public, max-age=60");
		expect(upstream.mock.calls[0][0].href).toBe(target);
		expect(upstream.mock.calls[0][1].body).toBeUndefined();
		expect(
			new Headers(upstream.mock.calls[0][1].headers).has("x-forwarded-for"),
		).toBe(false);
	});
	it.each([
		"/ingest//evil.example/path",
		"/ingest/%2f%2fevil.example/path",
		"/ingest/%5cevil.example/path",
	])("rejects destination tricks: %s", async (url) => {
		const upstream = vi.fn<IngestFetch>();
		const server = await serverWith(upstream);
		expect((await server.inject(url)).statusCode).toBe(400);
		expect(upstream).not.toHaveBeenCalled();
	});
	it("enforces the 1 MiB limit before contacting upstream", async () => {
		const upstream = vi.fn<IngestFetch>();
		const server = await serverWith(upstream);
		expect(
			(
				await server.inject({
					method: "POST",
					url: "/ingest/batch/",
					headers: { "content-type": "application/json" },
					payload: Buffer.alloc(1024 * 1024 + 1, 32),
				})
			).statusCode,
		).toBe(413);
		expect(upstream).not.toHaveBeenCalled();
	});
	it.each(["PUT", "DELETE", "OPTIONS", "HEAD"] as const)(
		"does not proxy unsupported method %s",
		async (method) => {
			const upstream = vi.fn<IngestFetch>();
			const server = await serverWith(upstream);
			expect(
				(await server.inject({ method, url: "/ingest/batch/" })).statusCode,
			).toBe(404);
			expect(upstream).not.toHaveBeenCalled();
		},
	);
	it.each(["network", "redirect"])(
		"returns an empty 502 for %s failure",
		async (failure) => {
			const upstream = vi.fn<IngestFetch>();
			if (failure === "network")
				upstream.mockRejectedValue(new Error("sensitive upstream detail"));
			else
				upstream.mockResolvedValue(
					new Response("redirect", {
						status: 302,
						headers: { location: "https://evil.example" },
					}),
				);
			const server = await serverWith(upstream);
			const response = await server.inject("/ingest/static/array.js");
			expect(response.statusCode).toBe(502);
			expect(response.body).toBe("");
			expect(response.headers.location).toBeUndefined();
			expect(upstream).toHaveBeenCalledTimes(1);
			expect(upstream.mock.calls[0][1].redirect).toBe("error");
		},
	);
	it("preserves upstream rate-limit responses for the future sink", async () => {
		const upstream = vi.fn<IngestFetch>().mockResolvedValue(
			new Response("limited", {
				status: 429,
				headers: { "retry-after": "30" },
			}),
		);
		const server = await serverWith(upstream);
		const response = await server.inject("/ingest/batch/");
		expect(response.statusCode).toBe(429);
		expect(response.body).toBe("limited");
		expect(response.headers["retry-after"]).toBe("30");
	});
	it.each(["headers", "body"])(
		"aborts a stalled upstream %s phase after ten seconds",
		async (phase) => {
			let entered!: () => void;
			const started = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const upstream = vi
				.fn<IngestFetch>()
				.mockImplementation((_url, { signal }) => {
					entered();
					if (phase === "headers")
						return new Promise((_resolve, reject) => {
							signal!.addEventListener("abort", () =>
								reject(new Error("aborted")),
							);
						});
					return Promise.resolve(
						new Response(
							new ReadableStream({
								start(controller) {
									signal!.addEventListener("abort", () =>
										controller.error(new Error("aborted")),
									);
								},
							}),
						),
					);
				});
			const server = await serverWith(upstream);
			vi.useFakeTimers();
			const scheduled = vi.spyOn(globalThis, "setTimeout");
			const cleared = vi.spyOn(globalThis, "clearTimeout");
			const pending = server.inject("/ingest/batch/").then((result) => result);
			await started;
			await vi.advanceTimersByTimeAsync(10000);
			const response = await pending;
			expect(response.statusCode).toBe(502);
			expect(response.body).toBe("");
			expect(upstream.mock.calls[0][1].signal!.aborted).toBe(true);
			const deadline = scheduled.mock.calls.findIndex(
				(call) => call[1] === 10000,
			);
			expect(deadline).toBeGreaterThanOrEqual(0);
			expect(cleared).toHaveBeenCalledWith(
				scheduled.mock.results[deadline].value,
			);
		},
	);
});
