import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: vi.fn(),
	init: vi.fn(),
	register: vi.fn(),
	start: vi.fn(),
	clock: vi.fn().mockResolvedValue({ offset_http_ms: null }),
	render: vi.fn(),
}));
vi.mock("./lib/runtimeConfig", () => ({
	initializeRuntimeConfig: mocks.config,
}));
vi.mock("react-dom/client", () => ({
	createRoot: () => ({ render: mocks.render }),
}));
vi.mock("posthog-js", () => ({
	default: { init: mocks.init, register: mocks.register },
}));
vi.mock("./router", () => ({ router: { subscribe: vi.fn() } }));
vi.mock("./utils/reloadApp", () => ({ consumeReloadMarker: vi.fn() }));
vi.mock("./services/telemetry/core", () => ({
	startTelemetry: mocks.start,
	track: vi.fn(),
}));
vi.mock("./services/telemetry/clockLifecycle", () => ({
	startClockCalibration: mocks.clock,
}));
vi.mock("./services/telemetry/inputCapture", () => ({
	startInputCapture: vi.fn(),
}));
vi.mock("./services/telemetry/bindStores", () => ({ bindStores: vi.fn() }));
beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	document.body.innerHTML = '<div id="root"></div>';
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string) => {
			if (new URL(input).hostname !== "127.0.0.1")
				throw new Error("Non-loopback request");
			return new Response(
				JSON.stringify({ auth: {}, firestore: {}, database: {} }),
			);
		}),
	);
});
afterEach(() => vi.unstubAllGlobals());
it.each([
	["production", "on", true],
	["production", "off", false],
	["preview", "on", true],
	["preview", "off", false],
	["emulator", "on", false],
])(
	"boot honors telemetry %s/%s with explicit hosted transport and local isolation",
	async (environment, telemetry, enabled) => {
		mocks.config.mockResolvedValue({ environment, telemetry, firebase: null });
		await import("./main");
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
		expect(mocks.init).toHaveBeenCalledTimes(enabled ? 1 : 0);
		if (enabled)
			expect(mocks.init).toHaveBeenCalledWith(expect.any(String), {
				api_host: "/ingest",
				ui_host: "https://us.posthog.com",
				defaults: "2025-05-24",
				capture_exceptions: true,
			});
		expect(mocks.clock).toHaveBeenCalledTimes(enabled ? 1 : 0);
		expect(mocks.start).toHaveBeenCalledWith({
			environment,
			telemetry,
			firebase: null,
		});
		if (enabled)
			expect(mocks.register).toHaveBeenCalledWith(
				expect.objectContaining({
					device_id: expect.any(String),
					device_label: expect.any(String),
					page_session_id: expect.any(String),
					environment,
					commit: expect.any(String),
				}),
			);
		if (environment !== "emulator") expect(fetch).not.toHaveBeenCalled();
	},
);
