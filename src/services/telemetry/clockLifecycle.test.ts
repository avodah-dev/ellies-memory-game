import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("./core", () => ({ track: mocks.track }));
import { startClockCalibration } from "./clockLifecycle";
import { getOffsets, resetClockForTests } from "./clock";
let stop: () => void;
beforeEach(() => {
	vi.useFakeTimers({
		toFake: [
			"setInterval",
			"clearInterval",
			"setTimeout",
			"clearTimeout",
			"Date",
			"performance",
		],
	});
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () => new Response(JSON.stringify({ now: Date.now() + 14500 })),
		),
	);
	mocks.track.mockClear();
});
afterEach(() => {
	stop?.();
	resetClockForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
it("recalibrates periodically, records history and stops completely", async () => {
	stop = startClockCalibration();
	await vi.advanceTimersByTimeAsync(1);
	expect(fetch).toHaveBeenCalledTimes(5);
	expect(mocks.track).toHaveBeenCalledWith("mm.clock.calibration", {
		reason: "boot",
		status: "ok",
	});
	await vi.advanceTimersByTimeAsync(31000);
	expect(fetch).toHaveBeenCalledTimes(10);
	expect(getOffsets().sample_id).toBe(2);
	stop();
	await vi.advanceTimersByTimeAsync(60000);
	expect(fetch).toHaveBeenCalledTimes(10);
});
it("invalidates hidden/offline and takes a fresh sample on visibility/online", async () => {
	stop = startClockCalibration();
	await vi.advanceTimersByTimeAsync(1);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
	document.dispatchEvent(new Event("visibilitychange"));
	expect(getOffsets().sample_id).toBeNull();
	await vi.advanceTimersByTimeAsync(31000);
	expect(fetch).toHaveBeenCalledTimes(5);
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	document.dispatchEvent(new Event("visibilitychange"));
	await vi.advanceTimersByTimeAsync(1);
	expect(fetch).toHaveBeenCalledTimes(10);
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
	window.dispatchEvent(new Event("offline"));
	expect(getOffsets().sample_id).toBeNull();
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
	window.dispatchEvent(new Event("online"));
	await vi.advanceTimersByTimeAsync(1);
	expect(fetch).toHaveBeenCalledTimes(15);
});
it("detects a wall clock step without using it to shift server timestamps", async () => {
	stop = startClockCalibration();
	await vi.advanceTimersByTimeAsync(1);
	vi.setSystemTime(Date.now() - 14500);
	await vi.advanceTimersByTimeAsync(1000);
	expect(mocks.track).toHaveBeenCalledWith("mm.clock.calibration", {
		reason: "clock-step",
		status: "invalidated",
	});
	expect(fetch).toHaveBeenCalledTimes(10);
});
it("does not overlap periodic runs or publish after cleanup", async () => {
	let resolve!: (r: Response) => void;
	vi.mocked(fetch).mockImplementation(
		() =>
			new Promise((r) => {
				resolve = r;
			}),
	);
	stop = startClockCalibration();
	await vi.advanceTimersByTimeAsync(31000);
	expect(fetch).toHaveBeenCalledTimes(1);
	stop();
	resolve(new Response('{"now":1}'));
	await vi.advanceTimersByTimeAsync(1);
	expect(getOffsets().sample_id).toBeNull();
	expect(mocks.track).not.toHaveBeenCalled();
});
