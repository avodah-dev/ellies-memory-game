import {
	connectionInputs,
	connectionSignal,
	releaseConnection,
} from "../services/telemetry/connection";
import { useEffect, useLayoutEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "../lib/firebase";
import { useOnlineStore } from "../stores/onlineStore";
import { observeRtdbClock } from "../services/telemetry/rtdbClock";
export function useOnlineConnection(roomCode: string) {
	const [connected, setConnected] = useState(false);
	const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
	const opponentConnected = useOnlineStore((s) => s.opponentConnected);
	useLayoutEffect(() => {
		connectionInputs(roomCode, browserOnline, connected, opponentConnected);
	}, [roomCode, browserOnline, connected, opponentConnected]);
	useEffect(() => {
		if (!roomCode) return;
		const clock = observeRtdbClock(rtdb);
		const stop = onValue(
			ref(rtdb, ".info/connected"),
			(snap) => {
				const value = snap.val() === true;
				connectionSignal(roomCode, "rtdb", value);
				setConnected(value);
				clock.connectionChanged(value);
			},
			() => {
				connectionSignal(roomCode, "rtdb", false);
				setConnected(false);
				clock.connectionChanged(false);
			},
		);
		// A brief browser outage need not close Firebase's existing socket.
		// Track these signals independently so an online event can resume the
		// server resynchronization without waiting for another socket event.
		const offline = () => {
			connectionSignal(roomCode, "browser", false);
			setBrowserOnline(false);
		};
		const online = () => {
			connectionSignal(roomCode, "browser", true);
			setBrowserOnline(true);
		};
		window.addEventListener("offline", offline);
		window.addEventListener("online", online);
		return () => {
			clock.stop();
			releaseConnection(roomCode);
			stop();
			window.removeEventListener("offline", offline);
			window.removeEventListener("online", online);
		};
	}, [roomCode]);
	return browserOnline && connected && opponentConnected;
}
