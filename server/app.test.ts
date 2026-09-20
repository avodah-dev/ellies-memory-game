import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, configFromEnvironment } from "./app";
import { parseRuntimeConfig } from "../shared/runtimeConfig";
let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "matchimus-server-"));
	await mkdir(join(root, "assets"));
	await writeFile(
		join(root, "index.html"),
		"<!doctype html><title>Matchimus</title>",
	);
	await writeFile(join(root, "assets", "app-hash.js"), "console.log('app')");
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
describe("Fly server contract", () => {
	it("serves direct game URLs and keeps missing assets as 404", async () => {
		const server = await createServer({
			root,
			config: { environment: "emulator", firebase: null, telemetry: "on" },
			commit: "test-sha",
		});
		try {
			const page = await server.inject("/online/game");
			expect(page.statusCode).toBe(200);
			expect(page.body).toContain("Matchimus");
			expect(page.headers["cache-control"]).toBe("no-store");
			expect(page.headers["clear-site-data"]).toBeUndefined();
			const reload = await server.inject("/?_matchimus_reload=test-nonce");
			expect(reload.statusCode).toBe(200);
			expect(reload.headers["cache-control"]).toBe("no-store");
			expect(reload.headers["clear-site-data"]).toBe('"cache"');
			expect((await server.inject("/assets/missing.js")).statusCode).toBe(404);
			expect((await server.inject("/.env")).statusCode).toBe(404);
			expect((await server.inject("/api/missing")).statusCode).toBe(404);
			const asset = await server.inject("/assets/app-hash.js");
			expect(asset.headers["cache-control"]).toContain("immutable");
			const health = await server.inject("/healthz");
			expect(health.json()).toEqual({
				status: "ok",
				commit: "test-sha",
				environment: "emulator",
			});
			expect(health.headers["content-security-policy"]).toContain(
				"connect-src 'self' http://127.0.0.1:*",
			);
			const config = await server.inject("/app-config.json");
			expect(config.headers["cache-control"]).toBe("no-store");
			expect(config.json()).toEqual({
				environment: "emulator",
				firebase: null,
				telemetry: "on",
			});
		} finally {
			await server.close();
		}
	});
	it("serves only whitelisted public configuration", async () => {
		const config = configFromEnvironment({
			APP_ENV: "preview",
			APP_TELEMETRY: "on",
			FIREBASE_CONFIG_JSON: JSON.stringify({
				projectId: "test-project",
				apiKey: "public-web-key",
				databaseURL: "https://test-project.firebaseio.com",
				private_key: "must-not-leak",
			}),
			UNRELATED_SECRET: "must-not-leak",
		});
		const server = await createServer({ root, config, commit: "abc" });
		try {
			const response = await server.inject("/app-config.json");
			expect(response.body).not.toContain("must-not-leak");
			expect(response.headers["content-security-policy"]).toBeUndefined();
			expect(response.json().firebase.projectId).toBe("test-project");
		} finally {
			await server.close();
		}
	});
	it("refuses missing or unsafe hosted configuration and missing builds", async () => {
		for (const env of [
			{},
			{ APP_ENV: "typo" },
			{ APP_ENV: "production", APP_TELEMETRY: "on" },
			{
				APP_ENV: "production",
				APP_TELEMETRY: "on",
				FIREBASE_CONFIG_JSON: "{}",
			},
			{
				APP_ENV: "production",
				APP_TELEMETRY: "on",
				FIREBASE_CONFIG_JSON: JSON.stringify({
					projectId: "demo-test",
					apiKey: "demo",
					databaseURL: "http://localhost",
				}),
			},
		])
			expect(() => configFromEnvironment(env)).toThrow();
		expect(() =>
			parseRuntimeConfig({
				environment: "production",
				telemetry: "on",
				firebase: { projectId: 12 },
			}),
		).toThrow();
		await expect(
			createServer({
				root: join(root, "missing"),
				config: { environment: "emulator", firebase: null, telemetry: "on" },
				commit: "abc",
			}),
		).rejects.toThrow();
	});
});
