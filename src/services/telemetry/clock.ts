export interface ClockOffsets {
	readonly offset_http_ms: number | null;
	readonly offset_rtdb_ms: number | null;
	readonly clock_rtt_ms: number | null;
	readonly http_sample_mono_ms: number | null;
	readonly rtdb_sample_mono_ms: number | null;
}
const empty: ClockOffsets = Object.freeze({
	offset_http_ms: null,
	offset_rtdb_ms: null,
	clock_rtt_ms: null,
	http_sample_mono_ms: null,
	rtdb_sample_mono_ms: null,
});
let offsets = empty;
export function setRtdbOffset(value: number | null) {
	const valid = typeof value === "number" && Number.isFinite(value);
	offsets = Object.freeze({
		...offsets,
		offset_rtdb_ms: valid ? value : null,
		rtdb_sample_mono_ms: valid ? performance.now() : null,
	});
}
// One immutable reference per calibration; enqueue does not allocate clock metadata.
export function getOffsets(): ClockOffsets {
	return offsets;
}
export function clockProperties(
	clock: ClockOffsets,
	wall: number,
	mono: number,
) {
	return {
		offset_http_ms: clock.offset_http_ms,
		offset_rtdb_ms: clock.offset_rtdb_ms,
		clock_rtt_ms: clock.clock_rtt_ms,
		clock_reference:
			clock.offset_rtdb_ms === null
				? ("uncalibrated" as const)
				: ("rtdb" as const),
		t_server:
			clock.offset_rtdb_ms === null ? null : wall + clock.offset_rtdb_ms,
		clock_http_age_ms:
			clock.http_sample_mono_ms === null
				? null
				: mono - clock.http_sample_mono_ms,
		clock_rtdb_age_ms:
			clock.rtdb_sample_mono_ms === null
				? null
				: mono - clock.rtdb_sample_mono_ms,
		// Estimate of Fly minus RTDB time, not proof of which clock is wrong.
		fly_rtdb_skew_ms:
			clock.offset_http_ms === null || clock.offset_rtdb_ms === null
				? null
				: clock.offset_http_ms - clock.offset_rtdb_ms,
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
			const ended = performance.now();
			const rtt = ended - start;
			if (
				typeof body.now === "number" &&
				Number.isFinite(body.now) &&
				rtt < best &&
				!signal?.aborted
			) {
				best = rtt;
				offsets = Object.freeze({
					...offsets,
					offset_http_ms: body.now - (wall + rtt / 2),
					clock_rtt_ms: rtt,
					http_sample_mono_ms: ended,
				});
			}
		} catch {
			/* Measurement failure must not affect the app. */
		}
	}
	return getOffsets();
}
export function resetClockForTests() {
	offsets = empty;
}
