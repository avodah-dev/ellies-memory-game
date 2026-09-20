import { onValue, ref, type Database } from "firebase/database";
import { setRtdbOffset } from "./clock";
import { track } from "./core";

// Observe the existing connection signal without contributing to gameplay readiness.
export function observeRtdbClock(database: Database) {
	let connected = false;
	let stopped = false;
	let candidate: number | null = null;
	let observedAt = 0;
	let unsubscribe = () => {};
	const publish = () => {
		if (stopped) return;
		if (!connected || candidate === null) {
			setRtdbOffset(null);
			return;
		}
		setRtdbOffset(candidate, observedAt);
		track("mm.clock.offset", {
			source: "rtdb",
			offset_ms: candidate,
			rtt_ms: null,
		});
	};
	setRtdbOffset(null);
	try {
		unsubscribe = onValue(
			ref(database, ".info/serverTimeOffset"),
			(snapshot) => {
				observedAt = performance.now();
				const value: unknown = snapshot.val();
				candidate =
					typeof value === "number" && Number.isFinite(value) ? value : null;
				publish();
			},
			() => {
				candidate = null;
				publish();
			},
		);
	} catch {
		// Telemetry cannot prevent a room from connecting.
	}
	return {
		connectionChanged(value: boolean) {
			connected = value;
			if (!value) candidate = null;
			publish();
		},
		stop() {
			if (stopped) return;
			stopped = true;
			setRtdbOffset(null);
			try {
				unsubscribe();
			} catch {
				// Cleanup must not interfere with the room's own listener cleanup.
			}
		},
	};
}
