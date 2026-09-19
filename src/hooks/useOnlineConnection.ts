import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "../lib/firebase";
import { useOnlineStore } from "../stores/onlineStore";
export function useOnlineConnection(roomCode: string) {
	const [connected, setConnected] = useState(false);
	const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
	const opponentConnected = useOnlineStore((s) => s.opponentConnected);
	useEffect(() => {
		if (!roomCode) return;
		const stop = onValue(
			ref(rtdb, ".info/connected"),
			(snap) => setConnected(snap.val() === true),
			() => setConnected(false),
		);
		// A brief browser outage need not close Firebase's existing socket.
		// Track these signals independently so an online event can resume the
		// server resynchronization without waiting for another socket event.
		const offline = () => setBrowserOnline(false);
		const online = () => setBrowserOnline(true);
		window.addEventListener("offline", offline);
		window.addEventListener("online", online);
		return () => {
			stop();
			window.removeEventListener("offline", offline);
			window.removeEventListener("online", online);
		};
	}, [roomCode]);
	return browserOnline && connected && opponentConnected;
}
