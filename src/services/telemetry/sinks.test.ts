import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeConfig } from "../../../shared/runtimeConfig";
import { prepareEvent, type PreparedEvent } from "./events";
import { IndexedDbSink, PostHogBatchSink, selectSinks } from "./sinks";
import { logDB } from "../logging/LogDB";
vi.mock("../logging/LogDB", () => ({
	logDB: {
		addLogs: vi.fn().mockResolvedValue(undefined),
		trimToCount: vi.fn().mockResolvedValue(undefined),
	},
}));
const active: { stop(): void }[] = [];
beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
	active.forEach((s) => s.stop());
	active.length = 0;
	vi.restoreAllMocks();
	vi.useRealTimers();
});
function event(i = 0, text = ""): PreparedEvent {
	return prepareEvent({
		event: "mm.nav.route",
		distinct_id: "device",
		uuid: `id-${i}`,
		timestamp: "2026-09-20T00:00:00.000Z",
		properties: {
			device_id: "device",
			device_label: "VICE",
			page_session_id: "page",
			seq: i,
			t_mono: i,
			t_wall: i,
			t_server: i,
			clock_reference: "rtdb",
			environment: "preview",
			commit: "abc",
			$process_person_profile: false,
			$geoip_disable: true,
			path: text,
		},
	});
}
function sink(fetchImpl: typeof fetch) {
	const s = new PostHogBatchSink(fetchImpl);
	active.push(s);
	return s;
}
describe("diagnostic sinks", () => {
	it("uses batch API shape, max50 events and48KiB UTF8; never parallelizes keepalive", async () => {
		let release!: (value: Response) => void;
		const network = vi
			.fn<typeof fetch>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					}),
			)
			.mockImplementation(async () => new Response('{"status":"Ok"}'));
		const s = sink(network);
		s.write(Array.from({ length: 120 }, (_, i) => event(i, "🦋".repeat(300))));
		s.flush();
		expect(network).toHaveBeenCalledTimes(1);
		release(new Response('{"status":"Ok"}'));
		await vi.advanceTimersByTimeAsync(10);
		let count = 0;
		for (const [url, options] of network.mock.calls) {
			expect(url).toBe("/ingest/batch/");
			expect(options?.keepalive).toBe(true);
			expect(options?.redirect).toBe("error");
			const body = options!.body as string;
			expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(
				48 * 1024,
			);
			const payload = JSON.parse(body);
			expect(payload.api_key).toMatch(/^phc_/);
			expect(payload.batch.length).toBeLessThanOrEqual(50);
			count += payload.batch.length;
			expect(payload.batch[0].properties.$process_person_profile).toBe(false);
			expect(
				payload.batch.every(
					(event: { properties: { $geoip_disable: boolean } }) =>
						event.properties.$geoip_disable === true,
				),
			).toBe(true);
			expect(payload.batch[0].distinct_id).toBe("device");
		}
		expect(count).toBe(120);
	});
	it("bounds offline queues, resumes on online, and retries with backoff while retaining UUID", async () => {
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		const network = vi
			.fn<typeof fetch>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockImplementation(async () => new Response("ok"));
		const s = sink(network);
		s.write(Array.from({ length: 2010 }, (_, i) => event(i)));
		expect(network).not.toHaveBeenCalled();
		expect(s.stats().dropped).toBe(10);
		vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
		window.dispatchEvent(new Event("online"));
		await vi.advanceTimersByTimeAsync(1999);
		expect(network).toHaveBeenCalledTimes(1);
		s.flush();
		expect(network).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(network).toHaveBeenCalledTimes(2);
		expect(network.mock.calls[0][1]?.body).toBe(network.mock.calls[1][1]?.body);
		expect(s.stats().failures).toBe(1);
	});
	it("drops oversized events and never logs on network failure", async () => {
		const logging = vi.spyOn(console, "error");
		const s = sink(
			vi.fn<typeof fetch>().mockRejectedValue(new Error("failed")),
		);
		expect(() =>
			s.write([event(1, "x".repeat(50000)), event(2)]),
		).not.toThrow();
		await vi.advanceTimersByTimeAsync(0);
		expect(s.stats()).toEqual({ dropped: 1, failures: 1 });
		expect(logging).not.toHaveBeenCalled();
	});
	it.each(["emulator", "preview", "production"] as const)(
		"selects explicit sinks for %s and both switch values",
		(environment) => {
			for (const telemetry of ["on", "off"] as const) {
				const config = {
					environment,
					telemetry,
					firebase:
						environment === "emulator"
							? null
							: {
									apiKey: "public",
									projectId: "test",
									databaseURL: "https://test.firebaseio.com",
								},
				} as RuntimeConfig;
				const selected = selectSinks(config);
				active.push(...selected);
				expect(selected.some((s) => s instanceof PostHogBatchSink)).toBe(
					environment !== "emulator" && telemetry === "on",
				);
				expect(selected.some((s) => s instanceof IndexedDbSink)).toBe(true);
			}
		},
	);
	it("bulk-writes local events without calling the console logger and counts failures", async () => {
		vi.mocked(logDB.addLogs).mockRejectedValueOnce(new Error("quota"));
		const s = new IndexedDbSink();
		active.push(s);
		s.write([event()]);
		await vi.advanceTimersByTimeAsync(0);
		expect(logDB.addLogs).toHaveBeenCalled();
		expect(s.stats()).toEqual({ dropped: 1, failures: 1 });
	});
});

it("calls fetch with the browser global receiver rather than the sink instance", async () => {
	const receiverSensitiveFetch = vi.fn(function (this: unknown) {
		if (this !== globalThis) throw new TypeError("Illegal invocation");
		return Promise.resolve(new Response('{"status":"Ok"}'));
	});
	const s = sink(receiverSensitiveFetch);
	s.write([event()]);
	await vi.advanceTimersByTimeAsync(0);
	expect(receiverSensitiveFetch).toHaveBeenCalledTimes(1);
	expect(s.stats()).toEqual({ dropped: 0, failures: 0 });
});
it("waits for the response body before sending the next keepalive batch", async () => {
	let finishBody!: () => void;
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode("ok"));
			finishBody = () => controller.close();
		},
	});
	const send = vi
		.fn<typeof fetch>()
		.mockResolvedValueOnce(new Response(body))
		.mockImplementation(async () => new Response("ok"));
	const s = sink(send);
	s.write(Array.from({ length: 60 }, (_, i) => event(i)));
	await vi.advanceTimersByTimeAsync(100);
	expect(send).toHaveBeenCalledTimes(1);
	expect(s.stats()).toEqual({ dropped: 0, failures: 0 });
	finishBody();
	await vi.advanceTimersByTimeAsync(100);
	expect(send).toHaveBeenCalledTimes(2);
	expect(s.stats()).toEqual({ dropped: 0, failures: 0 });
});
