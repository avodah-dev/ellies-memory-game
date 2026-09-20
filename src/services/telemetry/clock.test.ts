import { afterEach, expect, it, vi } from "vitest";
import {
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
	const clock = vi.spyOn(performance, "now");
	for (const rtt of [100, 40, 20, 80, 60])
		clock.mockReturnValueOnce(0).mockReturnValueOnce(rtt);
	const network = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => new Response('{"now":1050}'));
	setRtdbOffset(15);
	await measureHttpOffset(undefined, network);
	expect(network).toHaveBeenCalledTimes(5);
	expect(getOffsets()).toEqual({
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
