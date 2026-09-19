import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "../lib/firebase";
import { useOnlineStore } from "../stores/onlineStore";
export function useOnlineConnection(roomCode: string) {
	const [connected, setConnected] = useState(false);
	const opponentConnected = useOnlineStore((s) => s.opponentConnected);
	useEffect(() => {
		if (!roomCode) return;
		const stop = onValue(
			ref(rtdb, ".info/connected"),
			(snap) => setConnected(snap.val() === true),
			() => setConnected(false),
		);
		const offline = () => setConnected(false);
		window.addEventListener("offline", offline);
		return () => {
			stop();
			window.removeEventListener("offline", offline);
		};
	}, [roomCode]);
	return connected && opponentConnected;
}
