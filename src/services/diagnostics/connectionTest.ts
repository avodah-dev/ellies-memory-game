import { getContext, track } from "../telemetry/core";

export type Metrics = Record<string, string | number | boolean | null>;
export type TestName =
	| "http"
	| "firestore"
	| "rtdb"
	| "transport"
	| "network"
	| "frames"
	| "touch_a"
	| "touch_b";
export interface TestResult {
	test: TestName;
	status: "ok" | "error" | "timeout" | "cancelled" | "skipped";
	metrics: Metrics;
}
export interface Progress {
	test: TestName;
	result?: TestResult;
}
export interface ConnectionTestDeps {
	http(signal: AbortSignal): Promise<Metrics>;
	firestore(signal: AbortSignal): Promise<Metrics>;
	rtdb(signal: AbortSignal): Promise<Metrics>;
	transport(signal: AbortSignal): Promise<Metrics>;
	network(signal: AbortSignal): Promise<Metrics>;
	frames(signal: AbortSignal): Promise<Metrics>;
	touch_a(signal: AbortSignal): Promise<Metrics>;
	touch_b(signal: AbortSignal): Promise<Metrics>;
}
export class ProbeError extends Error {
	code: string;
	constructor(code: string) {
		super(code);
		this.code = code;
	}
}
export function abortError(signal: AbortSignal) {
	return signal.reason instanceof ProbeError
		? signal.reason
		: new ProbeError("cancelled");
}
// Abort the scope as well as settling the caller, so listeners/timers are disposed.
export async function bounded<T>(
	signal: AbortSignal,
	ms: number,
	task: (scope: AbortSignal) => Promise<T>,
): Promise<T> {
	if (signal.aborted) throw abortError(signal);
	const controller = new AbortController();
	const cancel = () => controller.abort(abortError(signal));
	signal.addEventListener("abort", cancel, { once: true });
	const timer = setTimeout(
		() => controller.abort(new ProbeError("timeout")),
		ms,
	);
	let rejectAbort: () => void = () => {};
	try {
		return await Promise.race([
			new Promise<never>((_, reject) => {
				rejectAbort = () => reject(abortError(controller.signal));
				controller.signal.addEventListener("abort", rejectAbort, {
					once: true,
				});
			}),
			Promise.resolve().then(() => {
				if (controller.signal.aborted) throw abortError(controller.signal);
				return task(controller.signal);
			}),
		]);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", cancel);
		controller.signal.removeEventListener("abort", rejectAbort);
		controller.abort(new ProbeError("finished"));
	}
}
export function summarize(values: number[]): Metrics {
	const ordered = [...values].sort((a, b) => a - b);
	const percentile = (p: number) =>
		ordered.length
			? ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)]
			: null;
	return {
		samples: values.length,
		min_ms: ordered[0] ?? null,
		median_ms: percentile(0.5),
		p95_ms: percentile(0.95),
		// Mean absolute difference between adjacent successful samples.
		jitter_ms:
			values.length > 1
				? values
						.slice(1)
						.reduce((sum, v, i) => sum + Math.abs(v - values[i]), 0) /
					(values.length - 1)
				: null,
	};
}
const steps: [TestName, number][] = [
	["http", 35000],
	["firestore", 22000],
	["rtdb", 26000],
	["transport", 1000],
	["network", 1000],
	["frames", 4000],
	["touch_a", 60000],
	["touch_b", 90000],
];
export async function runConnectionTest({
	signal,
	deps,
	onProgress,
}: {
	signal: AbortSignal;
	deps: ConnectionTestDeps;
	onProgress: (progress: Progress) => void;
}) {
	const testId = crypto.randomUUID();
	const context = { ...getContext() };
	const started = performance.now();
	const results: TestResult[] = [];
	track("mm.conntest.start", { ...context, test_id: testId });
	for (const [test, timeout] of steps) {
		if (signal.aborted) break;
		onProgress({ test });
		let result: TestResult;
		try {
			const metrics = await bounded(signal, timeout, deps[test]);
			result = {
				test,
				status:
					metrics.skipped === true
						? "skipped"
						: Number(metrics.failures) > 0
							? "error"
							: "ok",
				metrics,
			};
		} catch (error) {
			const code = error instanceof ProbeError ? error.code : "failed";
			result = {
				test,
				status:
					code === "timeout"
						? "timeout"
						: signal.aborted
							? "cancelled"
							: "error",
				metrics: { error_code: code },
			};
		}
		results.push(result);
		track("mm.conntest.result", {
			...context,
			...result.metrics,
			test_id: testId,
			test,
			status: result.status,
		});
		onProgress({ test, result });
	}
	track("mm.conntest.done", {
		...context,
		test_id: testId,
		cancelled: signal.aborted,
		results: results.length,
		ms_elapsed: performance.now() - started,
	});
	return { testId, results, cancelled: signal.aborted };
}
