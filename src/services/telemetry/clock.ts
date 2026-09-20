let httpOffset: number | null = null;
let rtdbOffset: number | null = null;
let httpRtt: number | null = null;
export function setRtdbOffset(value: number) {
	if (Number.isFinite(value)) rtdbOffset = value;
}
export function getOffsets() {
	return {
		offset_http_ms: httpOffset,
		offset_rtdb_ms: rtdbOffset,
		clock_rtt_ms: httpRtt,
	};
}
export async function measureHttpOffset(
	signal?: AbortSignal,
	fetchImpl: typeof fetch = fetch,
) {
	let best = Infinity;
	for (let i = 0; i < 5 && !signal?.aborted; i++) {
		const wall = Date.now();
		const start = performance.now();
		try {
			const response = await fetchImpl("/diag/ping", {
				cache: "no-store",
				redirect: "error",
				signal: signal
					? AbortSignal.any([signal, AbortSignal.timeout(3000)])
					: AbortSignal.timeout(3000),
			});
			if (!response.ok) continue;
			const body = await response.json();
			const rtt = performance.now() - start;
			if (
				typeof body.now === "number" &&
				Number.isFinite(body.now) &&
				rtt < best &&
				!signal?.aborted
			) {
				best = rtt;
				httpOffset = body.now - (wall + rtt / 2);
				httpRtt = rtt;
			}
		} catch {
			/* Measurement failure must not affect the app. */
		}
	}
	return getOffsets();
}
export function resetClockForTests() {
	httpOffset = null;
	rtdbOffset = null;
	httpRtt = null;
}
