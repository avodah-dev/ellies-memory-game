import { bounded, ProbeError, summarize, type Metrics } from "./connectionTest";

export async function httpProbe(signal: AbortSignal): Promise<Metrics> {
	const samples: number[] = [];
	let failures = 0;
	let cold: number | null = null;
	let best = Infinity;
	let offset: number | null = null;
	for (let i = 0; i < 10; i++) {
		if (signal.aborted) break;
		const start = performance.now();
		const wall = Date.now();
		try {
			const body = await bounded(signal, 3000, async (scope) => {
				const response = await fetch("/diag/ping", {
					cache: "no-store",
					redirect: "error",
					signal: scope,
				});
				if (!response.ok) throw new ProbeError("http-status");
				const data: unknown = await response.json();
				if (
					!data ||
					typeof data !== "object" ||
					!("now" in data) ||
					typeof data.now !== "number" ||
					!Number.isFinite(data.now)
				)
					throw new ProbeError("invalid-ping");
				return data.now;
			});
			const elapsed = performance.now() - start;
			if (i === 0) cold = elapsed;
			else samples.push(elapsed);
			if (elapsed < best) {
				best = elapsed;
				offset = body - (wall + elapsed / 2);
			}
		} catch {
			failures++;
		}
	}
	return {
		...summarize(samples),
		attempts: 10,
		failures,
		first_ping_ms: cold,
		measured_http_offset_ms: offset,
		offset_sample_rtt_ms: Number.isFinite(best) ? best : null,
	};
}
export async function transportProbe(): Promise<Metrics> {
	const resources = performance.getEntriesByType("resource");
	let listens = 0,
		pollingHints = 0;
	for (const entry of resources) {
		const url = new URL(entry.name, location.origin);
		if (!url.pathname.includes("/Listen/channel")) continue;
		listens++;
		if (url.searchParams.get("CI") === "1") pollingHints++;
	}
	return {
		observation:
			listens === 0
				? "not-observed"
				: pollingHints
					? "polling-hint"
					: "listen-observed",
		listen_entries: listens,
		polling_hints: pollingHints,
		informational: true,
	};
}
export async function networkProbe(): Promise<Metrics> {
	const connection = (
		navigator as Navigator & {
			connection?: {
				effectiveType?: string;
				downlink?: number;
				rtt?: number;
				saveData?: boolean;
			};
		}
	).connection;
	if (!connection) return { supported: false };
	return {
		supported: true,
		effective_type: connection.effectiveType ?? null,
		downlink_mbps: connection.downlink ?? null,
		estimated_rtt_ms: connection.rtt ?? null,
		save_data: connection.saveData ?? null,
	};
}
export function frameProbe(signal: AbortSignal): Promise<Metrics> {
	return new Promise((resolve, reject) => {
		if (document.visibilityState === "hidden") {
			reject(new ProbeError("page-hidden"));
			return;
		}
		const samples: number[] = [];
		let frame = 0;
		let last = performance.now();
		const start = last;
		const cleanup = () => {
			cancelAnimationFrame(frame);
			signal.removeEventListener("abort", abort);
			document.removeEventListener("visibilitychange", visibility);
		};
		const abort = () => {
			cleanup();
			reject(new ProbeError("cancelled"));
		};
		const visibility = () => {
			if (document.visibilityState === "hidden") {
				cleanup();
				reject(new ProbeError("page-hidden"));
			}
		};
		const tick = (now: number) => {
			samples.push(now - last);
			last = now;
			if (now - start >= 2000) {
				cleanup();
				resolve({
					...summarize(samples),
					max_ms: Math.max(...samples),
					le_17: samples.filter((n) => n <= 17).length,
					le_34: samples.filter((n) => n > 17 && n <= 34).length,
					le_50: samples.filter((n) => n > 34 && n <= 50).length,
					le_100: samples.filter((n) => n > 50 && n <= 100).length,
					gt_100: samples.filter((n) => n > 100).length,
					ms_window: now - start,
				});
			} else frame = requestAnimationFrame(tick);
		};
		signal.addEventListener("abort", abort, { once: true });
		document.addEventListener("visibilitychange", visibility);
		if (signal.aborted) abort();
		else frame = requestAnimationFrame(tick);
	});
}
