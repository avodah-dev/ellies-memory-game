import {
	CLOCK_DISCONTINUITY_MS,
	getOffsets,
	invalidateHttpClock,
	measureHttpOffset,
} from "./clock";
import { track } from "./core";

// Runs outside event capture. No overlapping calibration requests or hidden-tab pings.
export function startClockCalibration() {
	let stopped = false;
	let suspended = false;
	let controller: AbortController | null = null;
	let next = 0;
	let lastMono = performance.now();
	let lastWall = Date.now();
	const calibrate = (reason: string) => {
		if (
			stopped ||
			suspended ||
			controller ||
			document.visibilityState === "hidden" ||
			!navigator.onLine
		)
			return;
		const current = new AbortController();
		controller = current;
		const previous = getOffsets().sample_id;
		void measureHttpOffset(current.signal)
			.then((sample) => {
				if (stopped || current.signal.aborted) return;
				track("mm.clock.calibration", {
					reason,
					status: sample.sample_id !== previous ? "ok" : "failed",
				});
			})
			.finally(() => {
				if (controller === current) controller = null;
				next = performance.now() + 30000;
			});
	};
	const invalidate = (reason: string) => {
		// Resume establishes a new watchdog baseline, before its first delayed tick.
		lastMono = performance.now();
		lastWall = Date.now();
		controller?.abort();
		controller = null;
		invalidateHttpClock();
		track("mm.clock.calibration", { reason, status: "invalidated" });
		calibrate(reason);
	};
	const visibility = () => invalidate("visibility");
	const online = () => invalidate("online");
	const offline = () => invalidate("offline");
	const pageshow = () => {
		suspended = false;
		invalidate("pageshow");
	};
	const pagehide = () => {
		suspended = true;
		invalidate("pagehide");
	};
	document.addEventListener("visibilitychange", visibility);
	window.addEventListener("online", online);
	window.addEventListener("offline", offline);
	window.addEventListener("pageshow", pageshow);
	window.addEventListener("pagehide", pagehide);
	const timer = setInterval(() => {
		const mono = performance.now(),
			wall = Date.now();
		const gap = mono - lastMono;
		const discontinuity =
			Math.abs(wall - lastWall - gap) > CLOCK_DISCONTINUITY_MS;
		lastMono = mono;
		lastWall = wall;
		if (discontinuity || gap > 5000)
			invalidate(discontinuity ? "clock-step" : "scheduler-gap");
		else if (mono >= next) calibrate("periodic");
	}, 1000);
	calibrate("boot");
	return () => {
		stopped = true;
		controller?.abort();
		clearInterval(timer);
		document.removeEventListener("visibilitychange", visibility);
		window.removeEventListener("online", online);
		window.removeEventListener("offline", offline);
		window.removeEventListener("pageshow", pageshow);
		window.removeEventListener("pagehide", pagehide);
		invalidateHttpClock();
	};
}
