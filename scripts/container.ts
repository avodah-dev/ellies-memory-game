import { spawn, execFileSync } from "node:child_process";
import ports from "../local-ports.json";
import { fileURLToPath } from "node:url";
const image = "matchimus-verify:local";
const name = `matchimus-verify-${process.pid}`;
function run(command: string, args: string[], env = process.env) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { stdio: "inherit", env });
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)),
		);
	});
}
let started = false;
function cleanup() {
	if (started) {
		try {
			execFileSync("docker", ["stop", "--time", "5", name], {
				stdio: "ignore",
				timeout: 10000,
			});
		} catch {
			/* Container may already have stopped. */
		}
		started = false;
	}
}
process.on("SIGINT", () => {
	cleanup();
	process.exit(130);
});
process.on("SIGTERM", () => {
	cleanup();
	process.exit(143);
});
process.on("exit", cleanup);
try {
	const commit = execFileSync("git", ["rev-parse", "HEAD"], {
		encoding: "utf8",
	}).trim();
	await run("docker", [
		"build",
		"--platform",
		"linux/amd64",
		"--build-arg",
		`BUILD_COMMIT_SHA=${commit}`,
		"--tag",
		image,
		".",
	]);
	await run("docker", [
		"run",
		"--rm",
		"--detach",
		"--name",
		name,
		"--publish",
		`127.0.0.1:${ports.server}:${ports.server}`,
		"--env",
		"APP_ENV=emulator",
		"--env",
		`PORT=${ports.server}`,
		"--mount",
		`type=bind,source=${fileURLToPath(new URL("../tests/fixtures/reload-worker.js", import.meta.url))},target=/app/dist/__reload-test-worker.js,readonly`,
		image,
	]);
	started = true;
	const base = `http://127.0.0.1:${ports.server}`;
	let ready = false;
	for (let i = 0; i < 60; i++) {
		try {
			const response = await fetch(`${base}/healthz`, {
				signal: AbortSignal.timeout(1000),
			});
			if (response.ok) {
				const health = await response.json();
				if (
					!health ||
					typeof health !== "object" ||
					!("commit" in health) ||
					health.commit !== commit ||
					!("environment" in health) ||
					health.environment !== "emulator"
				)
					throw new Error("Unexpected container configuration");
				ready = true;
				break;
			}
		} catch {
			/* Waiting for server startup. */
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	if (!ready) throw new Error("Container did not become healthy");
	for (const route of ["/", "/local/game", "/online/game", "/privacy"]) {
		const response = await fetch(base + route);
		if (!response.ok || !(await response.text()).includes('<div id="root">'))
			throw new Error(`SPA route failed: ${route}`);
	}
	if ((await fetch(`${base}/assets/missing.js`)).status !== 404)
		throw new Error("Missing assets must return 404");
	await run("bun", ["run", "test:e2e"], {
		...process.env,
		E2E_SERVER: "container",
	});
} catch (error) {
	if (started) {
		try {
			execFileSync("docker", ["logs", name], { stdio: "inherit" });
		} catch {
			/* Preserve original failure. */
		}
	}
	console.error(error);
	process.exitCode = 1;
} finally {
	cleanup();
}
