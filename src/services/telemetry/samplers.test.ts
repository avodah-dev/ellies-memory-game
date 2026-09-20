import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setPerformanceRoute, stopPerformanceSamplers } from "./samplers";
import { track } from "./core";
vi.mock("./core", () => ({
	track: vi.fn(),
	counters: {
		cardRenders: 0,
		boardRenders: 0,
		appRenders: 0,
		modelPublishes: 0,
		cursorRx: 0,
		cursorTx: 0,
	},
}));
let frame: FrameRequestCallback;
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"requestAnimationFrame",
		vi.fn((callback: FrameRequestCallback) => {
			frame = callback;
			return 1;
		}),
	);
	vi.stubGlobal("cancelAnimationFrame", vi.fn());
	vi.stubGlobal("PerformanceObserver", undefined);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	sessionStorage.clear();
	vi.runOnlyPendingTimers();
});
afterEach(() => {
	stopPerformanceSamplers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
	vi.clearAllMocks();
});
it("runs only on visible game routes and emits bounded histograms and drift", () => {
	setPerformanceRoute("/online/waiting");
	expect(requestAnimationFrame).not.toHaveBeenCalled();
	setPerformanceRoute("/online/game");
	const start = performance.now();
	frame(start + 16);
	frame(start + 40);
	frame(start + 80);
	frame(start + 160);
	frame(start + 5100);
	expect(track).toHaveBeenCalledWith(
		"mm.perf.frames",
		expect.objectContaining({
			samples: 5,
			le_17: 1,
			le_34: 1,
			le_50: 1,
			le_100: 1,
			gt_100: 1,
		}),
	);
	expect(track).toHaveBeenCalledWith(
		"mm.perf.longframe",
		expect.objectContaining({ ms_duration: 4940 }),
	);
	vi.advanceTimersByTime(5000);
	expect(track).toHaveBeenCalledWith(
		"mm.perf.timer",
		expect.objectContaining({ ms_drift: 0 }),
	);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	document.dispatchEvent(new Event("visibilitychange"));
	expect(vi.getTimerCount()).toBe(0);
});
it("supports an explicit sampler-off comparison and shuts down on results navigation", () => {
	sessionStorage.setItem("matchimus-frame-sampler", "off");
	setPerformanceRoute("/online/game");
	expect(requestAnimationFrame).not.toHaveBeenCalled();
	sessionStorage.removeItem("matchimus-frame-sampler");
	vi.runOnlyPendingTimers();
	setPerformanceRoute("/online/waiting");
	setPerformanceRoute("/online/game");
	expect(vi.getTimerCount()).toBe(1);
	setPerformanceRoute("/game-over");
	expect(vi.getTimerCount()).toBe(0);
	expect(cancelAnimationFrame).toHaveBeenCalled();
});
