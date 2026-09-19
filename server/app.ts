import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
	parseRuntimeConfig,
	type RuntimeConfig,
} from "../shared/runtimeConfig";

export function configFromEnvironment(env: NodeJS.ProcessEnv): RuntimeConfig {
	return parseRuntimeConfig({
		environment: env.APP_ENV,
		firebase:
			env.APP_ENV === "emulator"
				? null
				: JSON.parse(env.FIREBASE_CONFIG_JSON ?? "null"),
	});
}
export async function createServer(options: {
	root: string;
	config: RuntimeConfig;
	commit: string;
	logger?: boolean;
}) {
	const app = Fastify({ logger: options.logger ?? false });
	// Refuse to serve a deployment with no built entry point.
	await readFile(join(options.root, "index.html"));
	app.addHook("onSend", async (_request, reply, payload) => {
		reply.header("X-Content-Type-Options", "nosniff");
		reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
		if (options.config.environment === "emulator")
			reply.header(
				"Content-Security-Policy",
				"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*; font-src 'self' data:; worker-src 'self' blob:",
			);
		return payload;
	});
	app.get("/healthz", (_request, reply) =>
		reply
			.header("Cache-Control", "no-store")
			.send({
				status: "ok",
				commit: options.commit,
				environment: options.config.environment,
			}),
	);
	app.get("/app-config.json", (_request, reply) =>
		reply.header("Cache-Control", "no-store").send(options.config),
	);
	await app.register(fastifyStatic, {
		root: options.root,
		setHeaders(response, file) {
			const name = relative(options.root, file);
			response.header(
				"Cache-Control",
				name.startsWith(`assets${sep}`)
					? "public, max-age=31536000, immutable"
					: "no-cache",
			);
		},
	});
	const routes = [
		"/local",
		"/local/theme",
		"/local/card-pack",
		"/local/background",
		"/local/card-back",
		"/local/pair-count",
		"/local/start",
		"/local/game",
		"/online",
		"/online/create",
		"/online/join",
		"/online/waiting",
		"/online/game",
		"/game-over",
		"/privacy",
		"/terms",
	];
	for (const route of routes)
		app.get(route, (_request, reply) => reply.sendFile("index.html"));
	return app;
}
