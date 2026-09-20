import { afterEach, expect, it, vi } from "vitest";
import {
	bounded,
	runConnectionTest,
	summarize,
	type ConnectionTestDeps,
} from "./connectionTest";
import { getContext, setContext, track } from "../telemetry/core";
vi.mock("../telemetry/core", () => ({
	getContext: vi.fn(() => ({ room_code: "TEST", is_host: true })),
	setContext: vi.fn(),
	track: vi.fn(),
}));
const deps = (): ConnectionTestDeps =>
	Object.fromEntries(
		[
			"http",
			"firestore",
			"rtdb",
			"transport",
			"network",
			"frames",
			"touch_a",
			"touch_b",
		].map((name) => [name, vi.fn().mockResolvedValue({ samples: 1 })]),
	) as unknown as ConnectionTestDeps;
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});
it("runs sequentially and captures initial room context through completion", async () => {
	const calls = deps();
	let resolve!: (value: { samples: number }) => void;
	vi.mocked(calls.http).mockImplementation(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	const progress = vi.fn();
	const run = runConnectionTest({
		signal: new AbortController().signal,
		deps: calls,
		onProgress: progress,
	});
	await Promise.resolve();
	expect(calls.firestore).not.toHaveBeenCalled();
	vi.mocked(getContext).mockReturnValue({ room_code: "OTHER" } as ReturnType<
		typeof getContext
	>);
	setContext({ room_code: "OTHER" });
	resolve({ samples: 10 });
	const report = await run;
	expect(report.results).toHaveLength(8);
	expect(track).toHaveBeenLastCalledWith(
		"mm.conntest.done",
		expect.objectContaining({
			room_code: "TEST",
			results: 8,
			cancelled: false,
		}),
	);
});
it("a hard timeout aborts its scope then allows independent tests to run", async () => {
	vi.useFakeTimers();
	const calls = deps();
	let scope: AbortSignal | undefined;
	vi.mocked(calls.http).mockImplementation((signal) => {
		scope = signal;
		return new Promise(() => {});
	});
	const run = runConnectionTest({
		signal: new AbortController().signal,
		deps: calls,
		onProgress: () => {},
	});
	await vi.advanceTimersByTimeAsync(35000);
	const report = await run;
	expect(scope?.aborted).toBe(true);
	expect(report.results[0].status).toBe("timeout");
	expect(calls.firestore).toHaveBeenCalledOnce();
	expect(vi.getTimerCount()).toBe(0);
});
it("cancellation settles a stuck operation and starts no subsequent test", async () => {
	const calls = deps();
	const controller = new AbortController();
	vi.mocked(calls.http).mockImplementation(() => new Promise(() => {}));
	const run = runConnectionTest({
		signal: controller.signal,
		deps: calls,
		onProgress: () => {},
	});
	await Promise.resolve();
	controller.abort();
	const report = await run;
	expect(report.cancelled).toBe(true);
	expect(report.results[0].status).toBe("cancelled");
	expect(calls.firestore).not.toHaveBeenCalled();
});
it("does not call a dependency for an already cancelled scope", async () => {
	const controller = new AbortController();
	controller.abort();
	const task = vi.fn();
	await expect(bounded(controller.signal, 10, task)).rejects.toThrow(
		"cancelled",
	);
	expect(task).not.toHaveBeenCalled();
});
it("reports partial failure and skipped probes honestly", async () => {
	const calls = deps();
	vi.mocked(calls.http).mockResolvedValue({ samples: 9, failures: 1 });
	vi.mocked(calls.touch_a).mockResolvedValue({ skipped: true });
	const report = await runConnectionTest({
		signal: new AbortController().signal,
		deps: calls,
		onProgress: () => {},
	});
	expect(report.results[0].status).toBe("error");
	expect(report.results[6].status).toBe("skipped");
});
it("summarizes successful samples without inventing empty measurements", () => {
	expect(summarize([])).toEqual({
		samples: 0,
		min_ms: null,
		median_ms: null,
		p95_ms: null,
		jitter_ms: null,
	});
	expect(summarize([10, 30, 20])).toEqual({
		samples: 3,
		min_ms: 10,
		median_ms: 20,
		p95_ms: 30,
		jitter_ms: 15,
	});
});
