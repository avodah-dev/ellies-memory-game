import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import ports from "./local-ports.json";
import { emulatorCsp } from "./shared/emulatorCsp";
import type { PreviewServer, ViteDevServer } from "vite";
const buildInfo = {
	commitHash:
		process.env.BUILD_COMMIT_SHA ??
		execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
	buildTime: new Date().toISOString(),
};
function localHealth(server: PreviewServer | ViteDevServer, commit: string) {
	server.middlewares.use("/healthz", (request, response) => {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Content-Type", "application/json");
		if (request.method !== "GET") {
			response.statusCode = 405;
			response.end();
			return;
		}
		response.end(
			JSON.stringify({ status: "ok", commit, environment: "emulator" }),
		);
	});
}

function localPing(server: PreviewServer | ViteDevServer) {
	server.middlewares.use("/diag/ping", (request, response) => {
		response.setHeader("Cache-Control", "no-store");
		response.setHeader("Content-Type", "application/json");
		if (request.method !== "GET") {
			response.statusCode = 405;
			response.end();
			return;
		}
		response.end(JSON.stringify({ now: Date.now() }));
	});
}

export default defineConfig(({ mode }) => ({
	plugins: [
		TanStackRouterVite(),
		react(),
		{
			name: "local-network-isolation",
			configureServer(server) {
				localPing(server);
				localHealth(server, buildInfo.commitHash);
			},
			configurePreviewServer(server) {
				localPing(server);
				const built = JSON.parse(
					readFileSync(
						resolve(
							server.config.root,
							server.config.build.outDir,
							"build-info.json",
						),
						"utf8",
					),
				);
				localHealth(server, built.commitHash);
			},
			generateBundle() {
				this.emitFile({
					type: "asset",
					fileName: "build-info.json",
					source: JSON.stringify(buildInfo),
				});
			},
			transformIndexHtml() {
				return mode === "production"
					? []
					: [
							{
								tag: "meta",
								attrs: {
									"http-equiv": "Content-Security-Policy",
									content: emulatorCsp,
								},
								injectTo: "head-prepend" as const,
							},
						];
			},
		},
	],
	define: {
		__BUILD_INFO__: JSON.stringify(buildInfo),
	},
	server: {
		host: "127.0.0.1",
		port: ports.web,
		strictPort: true,
		watch: { ignored: ["**/.cursor/**", "**/*-debug.log"] },
	},
	preview: { host: "127.0.0.1", port: ports.preview, strictPort: true },
	test: {
		globals: true,
		environment: "jsdom",
		setupFiles: "./src/test/setup.ts",
		include: ["src/**/*.test.{ts,tsx}"],
		coverage: {
			provider: "v8",
			reporter: ["text", "html", "json-summary"],
			include: [
				"src/services/game/**/*.ts",
				"src/services/sync/stateProtocol.ts",
				"src/hooks/useGameSynchronization.ts",
			],
			exclude: ["**/index.ts"],
			thresholds: { branches: 90, perFile: true },
		},
	},
}));
