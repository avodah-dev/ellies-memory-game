// The bound includes network ambiguity plus an explicit oscillator-rate budget.
// This is conditional on a stable server clock and <=1000 ppm monotonic drift;
// it is not a claim that browsers expose a certified oscillator accuracy.
export const CLOCK_RATE_BUDGET_PPM = 1000;
export const CLOCK_MAX_AGE_MS = 60000;
export const CLOCK_DISCONTINUITY_MS = 250;
const PRECISION_MS = 2;
export interface ClockOffsets {
	readonly offset_http_ms: number | null;
	readonly offset_rtdb_ms: number | null;
	readonly clock_rtt_ms: number | null;
	readonly http_sample_mono_ms: number | null;
	readonly rtdb_sample_mono_ms: number | null;
	readonly server_anchor_ms: number | null;
	readonly wall_anchor_ms: number | null;
	readonly sample_id: number | null;
}
const empty: ClockOffsets = Object.freeze({
	offset_http_ms: null,
	offset_rtdb_ms: null,
	clock_rtt_ms: null,
	http_sample_mono_ms: null,
	rtdb_sample_mono_ms: null,
	server_anchor_ms: null,
	wall_anchor_ms: null,
	sample_id: null,
});
let offsets = empty;
let sampleSeq = 0;
export function setRtdbOffset(
	value: number | null,
	observedAt = performance.now(),
) {
	const valid = typeof value === "number" && Number.isFinite(value);
	offsets = Object.freeze({
		...offsets,
		offset_rtdb_ms: valid ? value : null,
		rtdb_sample_mono_ms: valid ? observedAt : null,
	});
}
export function invalidateHttpClock() {
	offsets = Object.freeze({
		...offsets,
		offset_http_ms: null,
		clock_rtt_ms: null,
		http_sample_mono_ms: null,
		server_anchor_ms: null,
		wall_anchor_ms: null,
		sample_id: null,
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
	const age =
		clock.http_sample_mono_ms === null
			? null
			: mono - clock.http_sample_mono_ms;
	const wallDelta =
		clock.wall_anchor_ms === null || age === null
			? null
			: wall - clock.wall_anchor_ms - age;
	const valid =
		age !== null &&
		age >= 0 &&
		age <= CLOCK_MAX_AGE_MS &&
		clock.server_anchor_ms !== null &&
		clock.clock_rtt_ms !== null &&
		wallDelta !== null &&
		Math.abs(wallDelta) <= CLOCK_DISCONTINUITY_MS;
	const estimate = valid ? clock.server_anchor_ms! + age! : null;
	const networkBound =
		clock.clock_rtt_ms === null ? null : clock.clock_rtt_ms / 2 + PRECISION_MS;
	const uncertainty = valid
		? networkBound! + (age! * CLOCK_RATE_BUDGET_PPM) / 1e6
		: null;
	return {
		offset_http_ms: clock.offset_http_ms,
		offset_rtdb_ms: clock.offset_rtdb_ms,
		clock_rtt_ms: clock.clock_rtt_ms,
		clock_reference: valid
			? ("fly-monotonic" as const)
			: ("uncalibrated" as const),
		t_server: estimate,
		t_server_lower_ms: estimate === null ? null : estimate - uncertainty!,
		t_server_upper_ms: estimate === null ? null : estimate + uncertainty!,
		clock_uncertainty_ms: uncertainty,
		clock_network_bound_ms: networkBound,
		clock_rate_budget_ppm: CLOCK_RATE_BUDGET_PPM,
		clock_sample_id: clock.sample_id,
		clock_anchor_server_ms: clock.server_anchor_ms,
		clock_anchor_mono_ms: clock.http_sample_mono_ms,
		clock_wall_discontinuity_ms: wallDelta,
		clock_http_age_ms: age,
		clock_rtdb_age_ms:
			clock.rtdb_sample_mono_ms === null
				? null
				: mono - clock.rtdb_sample_mono_ms,
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
	let best: { server: number; mono: number; wall: number; rtt: number } | null =
		null;
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
			const body: unknown = await response.json();
			const ended = performance.now();
			const rtt = ended - start;
			if (
				!body ||
				typeof body !== "object" ||
				!("now" in body) ||
				typeof body.now !== "number" ||
				!Number.isFinite(body.now) ||
				rtt < 0 ||
				rtt > 3000 ||
				Math.abs(Date.now() - wall - rtt) > CLOCK_DISCONTINUITY_MS
			)
				continue;
			if (best === null || rtt < best.rtt)
				best = {
					server: body.now,
					mono: start + rtt / 2,
					wall: wall + rtt / 2,
					rtt,
				};
		} catch {
			/* Measurement failure must not affect the app. */
		}
	}
	if (best !== null && !signal?.aborted) {
		offsets = Object.freeze({
			...offsets,
			offset_http_ms: best.server - best.wall,
			clock_rtt_ms: best.rtt,
			http_sample_mono_ms: best.mono,
			server_anchor_ms: best.server,
			wall_anchor_ms: best.wall,
			sample_id: ++sampleSeq,
		});
	}
	return getOffsets();
}
export function resetClockForTests() {
	offsets = empty;
	sampleSeq = 0;
}
