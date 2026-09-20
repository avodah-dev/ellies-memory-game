import { setPerformanceRoute } from "./services/telemetry/samplers";
import { createRoot } from "react-dom/client";
import "./index.css";
import { RouterProvider } from "@tanstack/react-router";
import { initializeRuntimeConfig } from "./lib/runtimeConfig";
import ports from "../local-ports.json";
import { consumeReloadMarker } from "./utils/reloadApp";

import { startTelemetry, track } from "./services/telemetry/core";
import { measureHttpOffset } from "./services/telemetry/clock";
import {
	getDeviceIdentity,
	getPageSessionId,
} from "./services/telemetry/identity";
import { POSTHOG_PROJECT_TOKEN } from "./services/telemetry/sinks";

async function main() {
	const bootStart = performance.now();
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
	startTelemetry(config);
	track("mm.app.boot", {
		phase: "runtime-ready",
		ms_elapsed: performance.now() - bootStart,
	});
	window.addEventListener("error", () =>
		track("mm.app.error", { source: "error", error_type: "runtime" }),
	);
	window.addEventListener("unhandledrejection", () =>
		track("mm.app.error", {
			source: "unhandledrejection",
			error_type: "promise",
		}),
	);
	if (config.environment !== "emulator" && config.telemetry === "on") {
		void measureHttpOffset().then((offsets) => {
			if (offsets.offset_http_ms !== null)
				track("mm.clock.offset", {
					source: "http",
					offset_ms: offsets.offset_http_ms,
					rtt_ms: offsets.clock_rtt_ms,
				});
		});
		const { default: posthog } = await import("posthog-js");
		posthog.init(POSTHOG_PROJECT_TOKEN, {
			api_host: "/ingest",
			ui_host: "https://us.posthog.com",
			defaults: "2025-05-24",
			capture_exceptions: true,
		});
		const device = getDeviceIdentity();
		posthog.register({
			device_id: device.id,
			device_label: device.label,
			page_session_id: getPageSessionId(),
			environment: config.environment,
			commit: __BUILD_INFO__.commitHash,
		});
	}
	const { bindStores } = await import("./services/telemetry/bindStores");
	bindStores();
	const { router } = await import("./router");
	router.subscribe("onResolved", () => {
		track("mm.nav.route", { path: router.state.location.pathname });
		setPerformanceRoute(router.state.location.pathname);
	});
	track("mm.app.boot", {
		phase: "render-start",
		ms_elapsed: performance.now() - bootStart,
	});
	createRoot(rootElement).render(<RouterProvider router={router} />);
}
void main().catch((error) => {
	console.error(error);
	const root = document.getElementById("root");
	if (root)
		root.textContent =
			"Matchimus could not start. Please reload or contact the site owner.";
});
