import { afterEach, expect, it, vi } from "vitest";
import {
	clockProperties,
	getOffsets,
	measureHttpOffset,
	resetClockForTests,
	setRtdbOffset,
} from "./clock";
afterEach(() => {
	vi.restoreAllMocks();
	resetClockForTests();
});
it("chooses the lowest RTT of five samples and preserves independent RTDB offset", async () => {
	vi.spyOn(Date, "now").mockReturnValue(1000);
	setRtdbOffset(15);
	const clock = vi.spyOn(performance, "now");
	for (const rtt of [100, 40, 20, 80, 60])
		clock.mockReturnValueOnce(0).mockReturnValueOnce(rtt);
	const network = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => new Response('{"now":1050}'));
	await measureHttpOffset(undefined, network);
	expect(network).toHaveBeenCalledTimes(5);
	expect(getOffsets()).toMatchObject({
		offset_http_ms: 40,
		offset_rtdb_ms: 15,
		clock_rtt_ms: 20,
	});
});
it("silently tolerates invalid/network samples and cancellation", async () => {
	const network = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
	await expect(measureHttpOffset(undefined, network)).resolves.toMatchObject({
		offset_http_ms: null,
	});
	const controller = new AbortController();
	controller.abort();
	network.mockClear();
	await measureHttpOffset(controller.signal, network);
	expect(network).not.toHaveBeenCalled();
});

it("never substitutes HTTP or wall time for missing RTDB calibration", () => {
	const httpOnly = {
		offset_http_ms: -14470,
		offset_rtdb_ms: null,
		clock_rtt_ms: 20,
		http_sample_mono_ms: 10,
		rtdb_sample_mono_ms: null,
	};
	expect(clockProperties(httpOnly, 20000, 100)).toMatchObject({
		t_server: null,
		clock_reference: "uncalibrated",
		fly_rtdb_skew_ms: null,
	});
	const calibrated = {
		...httpOnly,
		offset_rtdb_ms: 5,
		rtdb_sample_mono_ms: 90,
	};
	expect(clockProperties(calibrated, 20000, 100)).toMatchObject({
		t_server: 20005,
		clock_reference: "rtdb",
		fly_rtdb_skew_ms: -14475,
		clock_http_age_ms: 90,
		clock_rtdb_age_ms: 10,
	});
	expect(
		clockProperties({ ...calibrated, offset_http_ms: null }, 20000, 100)
			.t_server,
	).toBe(20005);
	expect(
		clockProperties({ ...calibrated, offset_rtdb_ms: 0 }, 20000, 100).t_server,
	).toBe(20000);
});
it("returns immutable calibration references and invalidates non-finite samples", () => {
	setRtdbOffset(10);
	const old = getOffsets();
	expect(getOffsets()).toBe(old);
	setRtdbOffset(20);
	expect(old.offset_rtdb_ms).toBe(10);
	expect(getOffsets().offset_rtdb_ms).toBe(20);
	setRtdbOffset(NaN);
	expect(getOffsets().offset_rtdb_ms).toBeNull();
});
