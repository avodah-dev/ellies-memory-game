import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import ports from "../local-ports.json";
import firebase from "../firebase.json";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const children = new Set<ChildProcess>();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function signalChildren(signal: NodeJS.Signals) {
	for (const child of children) {
		if (!child.pid) continue;
		try {
			process.kill(-child.pid, signal);
		} catch {
			/* Already exited. */
		}
	}
}
let stopping: Promise<void> | undefined;
function stop() {
	return (stopping ??= (async () => {
		signalChildren("SIGTERM");
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			const running = [...children].some((child) => {
				try {
					process.kill(-child.pid!, 0);
					return true;
				} catch {
					return false;
				}
			});
			if (!running) return;
			await delay(100);
		}
		signalChildren("SIGKILL");
	})());
}
process.on("SIGINT", () => {
	void stop().then(() => process.exit(130));
});
process.on("SIGTERM", () => {
	void stop().then(() => process.exit(143));
});
process.on("exit", () => signalChildren("SIGKILL"));
function launch(command: string, args: string[]) {
	const child = spawn(command, args, {
		cwd,
		stdio: "inherit",
		detached: true,
		env: process.env,
	});
	children.add(child);
	return child;
}
function wait(child: ChildProcess) {
	return new Promise<void>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) =>
			code === 0
				? resolve()
				: reject(new Error(`Command exited ${code ?? signal}`)),
		);
	});
}
async function ready(child: ChildProcess) {
	const deadline = Date.now() + 90000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null || child.signalCode !== null)
			throw new Error("Emulators stopped before readiness");
		try {
			const response = await fetch(`http://127.0.0.1:${ports.hub}/emulators`, {
				signal: AbortSignal.timeout(1000),
			});
			const data = await response.json();
			if (
				data &&
				typeof data === "object" &&
				"auth" in data &&
				"firestore" in data &&
				"database" in data
			)
				return;
		} catch {
			/* Still starting. */
		}
		await delay(250);
	}
	throw new Error("Emulators did not become ready within 90 seconds");
}
async function assertFree(port: number) {
	await new Promise<void>((resolve, reject) => {
		const socket = createConnection({ host: "127.0.0.1", port });
		socket.setTimeout(1000);
		socket.once("connect", () => {
			socket.destroy();
			reject(
				new Error(`Port ${port} is in use; stop the other local stack first`),
			);
		});
		socket.once("timeout", () => {
			socket.destroy();
			reject(new Error(`Port ${port} check timed out`));
		});
		socket.once("error", (error: NodeJS.ErrnoException) => {
			socket.destroy();
			if (error.code === "ECONNREFUSED") resolve();
			else reject(error);
		});
	});
}
function validatePorts() {
	for (const name of [
		"auth",
		"firestore",
		"database",
		"hub",
		"logging",
		"ui",
	] as const) {
		if (
			firebase.emulators[name].host !== "127.0.0.1" ||
			firebase.emulators[name].port !== ports[name]
		)
			throw new Error(
				`firebase.json ${name} must match local-ports.json and bind to loopback`,
			);
	}
	if (firebase.emulators.firestore.websocketPort !== ports.firestoreWebSocket)
		throw new Error("Firestore websocket port must match local-ports.json");
}
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
	const requestedMode = process.argv[2];
	const modes = [
		"dev",
		"verify",
		"release",
		"checks",
		"vite",
		"container",
	] as const;
	type Mode = (typeof modes)[number];
	if (!requestedMode || !modes.includes(requestedMode as Mode))
		throw new Error(
			"Usage: bun scripts/local.ts dev|verify|release|checks|vite|container",
		);
	const mode = requestedMode as Mode;
	validatePorts();
	for (const port of Object.values(ports)) await assertFree(port);
	if (mode !== "dev") {
		// Release verifies both Vite and the container. Keep each browser test's
		// own timeout unchanged while budgeting for the expanded two-pass suite.
		const timeoutMinutes = mode === "release" ? 12 : 10;
		deadline = setTimeout(() => {
			console.error(`Local verification exceeded ${timeoutMinutes} minutes`);
			void stop().then(() => process.exit(1));
		}, timeoutMinutes * 60_000);
		if (["checks", "verify", "release"].includes(mode)) {
			await wait(launch("bun", ["run", "check"]));
			await wait(launch("bun", ["run", "test:ingest-runtime"]));
		}
	}
	const emulator = launch("node", [
		"node_modules/firebase-tools/lib/bin/firebase.js",
		"emulators:start",
		"--project",
		"demo-matchimus",
		"--config",
		"firebase.json",
	]);
	const emulatorStopped = wait(emulator).then(() => {
		throw new Error("Emulators stopped unexpectedly");
	});
	const work = async () => {
		await ready(emulator);
		if (mode === "dev") await wait(launch("bun", ["run", "dev"]));
		else {
			const steps = {
				checks: ["test:integration", "test:coverage"],
				vite: ["build", "test:e2e"],
				container: ["test:container"],
				verify: ["test:integration", "test:coverage", "build", "test:e2e"],
				release: [
					"test:integration",
					"test:coverage",
					"build",
					"test:e2e",
					"test:container",
				],
			}[mode];
			for (const step of steps) await wait(launch("bun", ["run", step]));
			console.log(`Local verification passed: ${mode} (${steps.join(", ")}).`);
		}
	};
	await Promise.race([work(), emulatorStopped]);
} catch (error) {
	console.error(error);
	process.exitCode = 1;
} finally {
	if (deadline) clearTimeout(deadline);
	await stop();
}
