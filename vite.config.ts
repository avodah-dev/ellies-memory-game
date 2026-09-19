import { execFileSync } from "node:child_process";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import ports from "./local-ports.json";

export default defineConfig(({ mode }) => ({
	plugins: [
		TanStackRouterVite(),
		react(),
		{
			name: "local-network-isolation",
			transformIndexHtml() {
				return mode === "production"
					? []
					: [
							{
								tag: "meta",
								attrs: {
									"http-equiv": "Content-Security-Policy",
									content:
										"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:; worker-src 'self' blob:",
								},
								injectTo: "head-prepend" as const,
							},
						];
			},
		},
	],
	define: {
		__BUILD_INFO__: JSON.stringify({
			commitHash:
				process.env.BUILD_COMMIT_SHA ??
				execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
			buildTime: new Date().toISOString(),
		}),
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
