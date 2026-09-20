import { afterEach, expect, it, vi } from "vitest";
import {
	httpProbe,
	networkProbe,
	transportProbe,
	frameProbe,
} from "./browserProbes";
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});
it("uses same-origin no-store pings, consumes bodies, and separates first from warm samples", async () => {
	let time = 0;
	vi.spyOn(performance, "now").mockImplementation(() => time);
	vi.spyOn(Date, "now").mockReturnValue(1000);
	const fetch = vi.fn().mockImplementation(async () => {
		time += 10;
		return new Response(JSON.stringify({ now: 1005 }));
	});
	vi.stubGlobal("fetch", fetch);
	const result = await httpProbe(new AbortController().signal);
	expect(result).toMatchObject({
		attempts: 10,
		samples: 9,
		failures: 0,
		first_ping_ms: 10,
		median_ms: 10,
		measured_http_offset_ms: 0,
	});
	expect(fetch).toHaveBeenCalledTimes(10);
	expect(fetch).toHaveBeenCalledWith(
		"/diag/ping",
		expect.objectContaining({
			cache: "no-store",
			redirect: "error",
			signal: expect.any(AbortSignal),
		}),
	);
});
it("counts malformed or failed pings rather than reporting a successful connection", async () => {
	vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("broken")));
	const result = await httpProbe(new AbortController().signal);
	expect(result).toMatchObject({
		failures: 10,
		samples: 0,
		first_ping_ms: null,
		measured_http_offset_ms: null,
	});
});
it("handles missing network API explicitly", async () => {
	expect(await networkProbe()).toEqual({ supported: false });
});
it("does not claim an observed Listen request proves a transport", async () => {
	vi.spyOn(performance, "getEntriesByType").mockReturnValue([
		{
			name: "https://firestore.googleapis.com/google.firestore.v1.Firestore/Listen/channel?CI=1",
		},
	] as PerformanceEntry[]);
	expect(await transportProbe()).toEqual({
		observation: "polling-hint",
		listen_entries: 1,
		polling_hints: 1,
		informational: true,
	});
});
it("cancels the jank sampler without leaving frame callbacks or listeners", async () => {
	const cancel = vi.fn();
	vi.stubGlobal("cancelAnimationFrame", cancel);
	vi.stubGlobal("requestAnimationFrame", () => 123);
	const controller = new AbortController();
	const result = frameProbe(controller.signal);
	controller.abort();
	await expect(result).rejects.toThrow("cancelled");
	expect(cancel).toHaveBeenCalledWith(123);
});
