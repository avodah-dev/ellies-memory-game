import { createRoot } from "react-dom/client";
import "./index.css";
import { RouterProvider } from "@tanstack/react-router";
import { initializeRuntimeConfig } from "./lib/runtimeConfig";
import ports from "../local-ports.json";
import { consumeReloadMarker } from "./utils/reloadApp";

async function main() {
	consumeReloadMarker();
	const rootElement = document.getElementById("root");
	if (!rootElement) throw new Error("Root element not found");
	const config = await initializeRuntimeConfig();
	if (config.environment === "emulator") {
		try {
			const response = await fetch(`http://127.0.0.1:${ports.hub}/emulators`, {
				signal: AbortSignal.timeout(3000),
			});
			if (!response.ok) throw new Error("Emulators unavailable");
			const running = await response.json();
			if (!running.auth || !running.firestore || !running.database)
				throw new Error("All Firebase emulators are required");
		} catch {
			rootElement.textContent =
				"Local Firebase emulators are unavailable. Start the app with bun run dev:local.";
			return;
		}
	}
	if (config.environment === "production" && config.telemetry === "on") {
		const { default: posthog } = await import("posthog-js");
		posthog.init("phc_LMb2gHTzOA8grLHOZJFsGvfiX2Adcb41Nqbux1EW0yH", {
			api_host: "https://us.i.posthog.com",
			defaults: "2025-05-24",
			capture_exceptions: true,
		});
	}
	const { router } = await import("./router");
	createRoot(rootElement).render(<RouterProvider router={router} />);
}
void main().catch((error) => {
	console.error(error);
	const root = document.getElementById("root");
	if (root)
		root.textContent =
			"Matchimus could not start. Please reload or contact the site owner.";
});
