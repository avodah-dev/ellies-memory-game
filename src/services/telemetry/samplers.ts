import { counters, track } from "./core";
let activePath = "";
let stop: (() => void) | null = null;
let listening = false;
function refresh() {
	stop?.();
	stop = null;
	if (
		document.visibilityState !== "visible" ||
		!["/online/game", "/local/game"].includes(activePath)
	)
		return;
	// Explicit preview diagnostic switch for observer-cost comparison; never changes analytics.
	try {
		if (sessionStorage.getItem("matchimus-frame-sampler") === "off") return;
	} catch {
		/* Storage permission does not affect sampling. */
	}
	let last = performance.now(),
		windowAt = last,
		frame = 0,
		interval = 0,
		max = 0,
		samples = 0;
	let buckets = [0, 0, 0, 0, 0],
		previous = { ...counters };
	const observers: PerformanceObserver[] = [];
	const report = (now: number) => {
		const count = { ...counters };
		track("mm.perf.frames", {
			samples,
			ms_max: max,
			ms_window: now - windowAt,
			le_17: buckets[0],
			le_34: buckets[1],
			le_50: buckets[2],
			le_100: buckets[3],
			gt_100: buckets[4],
			card_renders: count.cardRenders - previous.cardRenders,
			board_renders: count.boardRenders - previous.boardRenders,
			app_renders: count.appRenders - previous.appRenders,
			model_publishes: count.modelPublishes - previous.modelPublishes,
			cursor_rx: count.cursorRx - previous.cursorRx,
			cursor_tx: count.cursorTx - previous.cursorTx,
		});
		previous = count;
		samples = 0;
		max = 0;
		buckets = [0, 0, 0, 0, 0];
		windowAt = now;
	};
	const tick = (now: number) => {
		const dt = now - last;
		last = now;
		samples++;
		max = Math.max(max, dt);
		buckets[dt <= 17 ? 0 : dt <= 34 ? 1 : dt <= 50 ? 2 : dt <= 100 ? 3 : 4]++;
		if (dt > 250) track("mm.perf.longframe", { ms_duration: dt });
		if (now - windowAt >= 5000) report(now);
		frame = requestAnimationFrame(tick);
	};
	frame = requestAnimationFrame(tick);
	let due = performance.now() + 100,
		driftMax = 0,
		driftSamples = 0;
	interval = window.setInterval(() => {
		const now = performance.now();
		driftMax = Math.max(driftMax, now - due);
		due = now + 100;
		if (++driftSamples >= 50) {
			track("mm.perf.timer", { ms_drift: driftMax });
			driftMax = 0;
			driftSamples = 0;
		}
	}, 100);
	if (typeof PerformanceObserver !== "undefined")
		for (const type of ["longtask", "event"]) {
			if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
			try {
				const observer = new PerformanceObserver((list) => {
					for (const entry of list.getEntries())
						track("mm.perf.longtask", {
							entry_type: type,
							ms_duration: entry.duration,
						});
				});
				observer.observe({
					type,
					buffered: false,
					durationThreshold: 40,
				} as PerformanceObserverInit & { durationThreshold: number });
				observers.push(observer);
			} catch {
				/* unavailable */
			}
		}
	stop = () => {
		cancelAnimationFrame(frame);
		clearInterval(interval);
		observers.forEach((observer) => observer.disconnect());
		if (samples) report(performance.now());
	};
}
export function setPerformanceRoute(path: string) {
	if (!listening) {
		document.addEventListener("visibilitychange", refresh);
		listening = true;
	}
	if (activePath === path) return;
	activePath = path;
	refresh();
}
export function stopPerformanceSamplers() {
	stop?.();
	stop = null;
	activePath = "";
	document.removeEventListener("visibilitychange", refresh);
	listening = false;
}
