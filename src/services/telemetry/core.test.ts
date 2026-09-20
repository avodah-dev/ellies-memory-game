import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	__resetForTests,
	beginInput,
	currentInputId,
	flushNow,
	setContext,
	startTelemetry,
	telemetryStats,
	track,
} from "./core";
import { MemorySink } from "./sinks";
vi.mock("../logging/LogDB", () => ({
	logDB: {
		addLogs: vi.fn().mockResolvedValue(undefined),
		trimToCount: vi.fn().mockResolvedValue(undefined),
	},
}));
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("matchMedia", () => ({ matches: false }));
	__resetForTests();
});
afterEach(() => {
	__resetForTests();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});
const local = {
	environment: "emulator",
	telemetry: "on",
	firebase: null,
} as const;
describe("telemetry core", () => {
	it("is inert before start, bounds the ring, and preserves monotonic sequence numbers", () => {
		for (let i = 0; i < 3100; i++) track("mm.nav.route", { path: String(i) });
		flushNow();
		expect(vi.getTimerCount()).toBe(0);
		expect(telemetryStats()).toMatchObject({ dropped: 100, queued: 3000 });
		const sink = new MemorySink();
		startTelemetry(local, [sink]);
		flushNow();
		expect(sink.events[0].properties.seq).toBe(102);
		expect(sink.events[0].properties.path).toBe("101");
		expect(sink.events.length).toBeLessThanOrEqual(50);
	});
	it("captures context at enqueue time and clears input correlation in a microtask", async () => {
		const sink = new MemorySink();
		startTelemetry(local, [sink]);
		setContext({ room_code: "AAAA" });
		const id = beginInput();
		track("mm.nav.route", { path: "/first" });
		setContext({ room_code: "BBBB" });
		await Promise.resolve();
		expect(currentInputId()).toBeNull();
		track("mm.nav.route", { path: "/second" });
		flushNow();
		expect(sink.events[1].properties).toMatchObject({
			room_code: "AAAA",
			input_id: id,
			environment: "emulator",
			$process_person_profile: false,
		});
		expect(sink.events[2].properties).toMatchObject({
			room_code: "BBBB",
			input_id: null,
		});
	});
	it("drains in bounded slices, re-arms and flushes on pagehide/hidden", async () => {
		const sink = new MemorySink();
		startTelemetry(local, [sink]);
		for (let i = 0; i < 110; i++) track("mm.nav.route", { path: "/" });
		await vi.advanceTimersByTimeAsync(2005);
		expect(sink.events).toHaveLength(111);
		track("mm.nav.route", { path: "/hidden" });
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		expect(sink.events.at(-1)?.event).toBe("mm.app.visibility");
		track("mm.nav.route", { path: "/bye" });
		window.dispatchEvent(new Event("pagehide"));
		expect(sink.events.at(-1)?.properties.path).toBe("/bye");
	});
	it("yields when enrichment reaches the time budget and reports failures silently", () => {
		const bad = {
			write() {
				throw new Error("storage");
			},
			flush() {},
			stop() {},
			stats() {
				return { dropped: 2, failures: 1 };
			},
		};
		const sink = new MemorySink();
		startTelemetry(local, [bad, sink]);
		for (let i = 0; i < 10; i++) track("mm.nav.route", { path: "/" });
		let time = 0;
		vi.spyOn(performance, "now").mockImplementation(() => (time += 5));
		expect(() => flushNow()).not.toThrow();
		expect(sink.events).toHaveLength(1);
		expect(telemetryStats().invalid).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
	});
});
