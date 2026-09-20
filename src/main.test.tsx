import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	config: vi.fn(),
	init: vi.fn(),
	render: vi.fn(),
}));
vi.mock("./lib/runtimeConfig", () => ({
	initializeRuntimeConfig: mocks.config,
}));
vi.mock("react-dom/client", () => ({
	createRoot: () => ({ render: mocks.render }),
}));
vi.mock("posthog-js", () => ({ default: { init: mocks.init } }));
vi.mock("./router", () => ({ router: {} }));
vi.mock("./utils/reloadApp", () => ({ consumeReloadMarker: vi.fn() }));
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
	["preview", "on", false],
	["preview", "off", false],
	["emulator", "on", false],
])(
	"boot honors telemetry %s/%s without changing current analytics settings",
	async (environment, telemetry, enabled) => {
		mocks.config.mockResolvedValue({ environment, telemetry, firebase: null });
		await import("./main");
		await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(1));
		expect(mocks.init).toHaveBeenCalledTimes(enabled ? 1 : 0);
		if (enabled)
			expect(mocks.init).toHaveBeenCalledWith(expect.any(String), {
				api_host: "https://us.i.posthog.com",
				defaults: "2025-05-24",
				capture_exceptions: true,
			});
		if (environment !== "emulator") expect(fetch).not.toHaveBeenCalled();
	},
);
