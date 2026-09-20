// Exercise the actual Bun fetch transport against a loopback-only upstream.
// Vitest's Node tests cover the policy; this verifies runtime byte handling.
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { strict as assert } from "node:assert";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { createServer } from "../server/app";
import ports from "../local-ports.json";

const root = await mkdtemp(join(tmpdir(), "matchimus-proxy-runtime-"));
await writeFile(
	join(root, "index.html"),
	"<!doctype html><title>Matchimus</title>",
);
const base = `http://127.0.0.1:${ports.server}`;
const payload = gzipSync(Buffer.from('[{"event":"local-proxy-contract"}]'));
const seen: string[] = [];
const upstream = createHttpServer(async (request, response) => {
	seen.push(request.url!);
	if (request.url === "/redirect") {
		response.writeHead(302, { location: base + "/must-not-follow" });
		response.end();
		return;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	const bytes = Buffer.concat(chunks);
	const valid =
		bytes.equals(payload) &&
		request.headers.cookie === undefined &&
		request.headers.authorization === undefined;
	const compressed = gzipSync(
		Buffer.from(valid ? "accepted" : "bad request bytes or headers"),
	);
	response.writeHead(valid ? 200 : 400, {
		"content-type": "text/plain",
		"content-encoding": "gzip",
		"content-length": compressed.length,
		"set-cookie": "upstream=private",
	});
	response.end(compressed);
});
const app = await createServer({
	root,
	commit: "loopback-contract",
	config: {
		environment: "preview",
		telemetry: "on",
		firebase: {
			projectId: "test-project",
			apiKey: "test-public-key",
			databaseURL: "https://test-project.firebaseio.com",
		},
	},
	ingestFetch: (url, options) => {
		assert.equal(url.origin, "https://us.i.posthog.com");
		return fetch(new URL(url.pathname + url.search, base), options);
	},
});
try {
	upstream.listen(ports.server, "127.0.0.1");
	await once(upstream, "listening");
	const response = await app.inject({
		method: "POST",
		url: "/ingest/batch/?compression=gzip-js",
		payload,
		headers: {
			"content-type": "text/plain",
			cookie: "private=not-forwarded",
			authorization: "Bearer not-forwarded",
		},
	});
	assert.equal(response.statusCode, 200);
	assert.equal(response.body, "accepted");
	assert.equal(response.headers["content-encoding"], undefined);
	assert.equal(response.headers["set-cookie"], undefined);
	assert.equal(
		Number(response.headers["content-length"]),
		Buffer.byteLength(response.body),
	);
	assert.equal((await app.inject("/ingest/redirect")).statusCode, 502);
	assert.deepEqual(seen, ["/batch/?compression=gzip-js", "/redirect"]);
	console.log(
		"Bun proxy contract passed: raw gzip request, decoded response, header stripping and redirect blocking; loopback only.",
	);
} finally {
	await app.close();
	upstream.closeAllConnections();
	if (upstream.listening)
		await new Promise<void>((resolve, reject) =>
			upstream.close((error) => (error ? reject(error) : resolve())),
		);
	await rm(root, { recursive: true, force: true });
}
