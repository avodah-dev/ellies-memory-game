import { afterEach, expect, it, vi } from "vitest";
import {
	CLOCK_MAX_AGE_MS,
	clockProperties,
	getOffsets,
	invalidateHttpClock,
	measureHttpOffset,
	resetClockForTests,
	setRtdbOffset,
} from "./clock";
afterEach(() => {
	vi.restoreAllMocks();
	resetClockForTests();
});
async function calibrate() {
	let mono = 100;
	vi.spyOn(performance, "now").mockImplementation(() => mono);
	vi.spyOn(Date, "now").mockImplementation(() => mono + 14500);
	const network = vi.fn<typeof fetch>().mockImplementation(async () => {
		mono += 20;
		return new Response('{"now":100000}');
	});
	await measureHttpOffset(undefined, network);
	return getOffsets();
}
it("chooses the lowest RTT and anchors server time to monotonic midpoint despite wall clock error", async () => {
	let mono = 0;
	const rtts = [100, 40, 20, 80, 60];
	vi.spyOn(performance, "now").mockImplementation(() => mono);
	vi.spyOn(Date, "now").mockImplementation(() => 14500 + mono);
	setRtdbOffset(15);
	await measureHttpOffset(
		undefined,
		vi.fn<typeof fetch>().mockImplementation(async () => {
			mono += rtts.shift()!;
			return new Response('{"now":100000}');
		}),
	);
	expect(getOffsets()).toMatchObject({
		server_anchor_ms: 100000,
		http_sample_mono_ms: 150,
		clock_rtt_ms: 20,
		offset_rtdb_ms: 15,
		sample_id: 1,
	});
	expect(clockProperties(getOffsets(), 14800, 300)).toMatchObject({
		t_server: 100150,
		clock_reference: "fly-monotonic",
		clock_network_bound_ms: 12,
		clock_uncertainty_ms: 12.15,
		t_server_lower_ms: 100137.85,
		t_server_upper_ms: 100162.15,
	});
});
it("does not let RTDB supply merged timestamps", () => {
	setRtdbOffset(-14500);
	expect(clockProperties(getOffsets(), 15000, 500)).toMatchObject({
		t_server: null,
		clock_reference: "uncalibrated",
		offset_rtdb_ms: -14500,
	});
});
it("expires calibration, grows the explicit rate allowance, and rejects wall/sleep discontinuities", async () => {
	const sample = await calibrate();
	const mono = sample.http_sample_mono_ms!;
	const wall = sample.wall_anchor_ms!;
	expect(clockProperties(sample, wall + 30000, mono + 30000)).toMatchObject({
		t_server: 130000,
		clock_uncertainty_ms: 42,
	});
	for (const [w, m] of [
		[wall + 60001, mono + CLOCK_MAX_AGE_MS + 1],
		[wall - 1, mono - 1],
		[wall + 15000, mono + 100],
		[wall, mono + 1000],
	])
		expect(clockProperties(sample, w, m).t_server).toBeNull();
	// The wall clock is only a validity check: a small change never shifts the estimate.
	expect(clockProperties(sample, wall + 200, mono + 100).t_server).toBe(100100);
});
it("retains immutable enqueue calibration even after replacement and invalidation", async () => {
	const sample = await calibrate();
	invalidateHttpClock();
	expect(getOffsets().server_anchor_ms).toBeNull();
	expect(sample.server_anchor_ms).toBe(100000);
	setRtdbOffset(NaN);
	expect(getOffsets().offset_rtdb_ms).toBeNull();
});
it("rejects invalid responses, network failures, negative/overlong RTT and clock changes during a request", async () => {
	let mono = 0,
		wall = 0;
	vi.spyOn(performance, "now").mockImplementation(() => mono);
	vi.spyOn(Date, "now").mockImplementation(() => wall);
	const network = vi
		.fn<typeof fetch>()
		.mockRejectedValueOnce(new Error("offline"))
		.mockResolvedValueOnce(new Response("null"))
		.mockImplementationOnce(async () => {
			mono = -1;
			return new Response('{"now":1}');
		})
		.mockImplementationOnce(async () => {
			mono += 4000;
			wall += 4000;
			return new Response('{"now":1}');
		})
		.mockImplementationOnce(async () => {
			mono += 10;
			wall += 15000;
			return new Response('{"now":1}');
		});
	await measureHttpOffset(undefined, network);
	expect(getOffsets().sample_id).toBeNull();
});
it("does not publish an aborted calibration or start requests after abort", async () => {
	const controller = new AbortController();
	const network = vi.fn<typeof fetch>().mockImplementation(async () => {
		controller.abort();
		return new Response('{"now":100}');
	});
	await measureHttpOffset(controller.signal, network);
	expect(getOffsets().sample_id).toBeNull();
	network.mockClear();
	await measureHttpOffset(controller.signal, network);
	expect(network).not.toHaveBeenCalled();
});
