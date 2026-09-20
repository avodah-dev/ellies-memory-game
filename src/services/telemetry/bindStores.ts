import { useOnlineStore } from "../../stores/onlineStore";
import { setContext, track } from "./core";

export function bindStores() {
	// Direct Zustand subscriptions never wake a React component. Pick scalar data only;
	// names, colors and the full room/presence payload must never enter telemetry.
	return useOnlineStore.subscribe(
		(s) =>
			[
				s.odahId,
				s.roomCode,
				s.isHost,
				s.room?.status ?? null,
				s.connectionStatus,
				s.opponentConnected,
			] as const,
		(
			[odahId, roomCode, isHost, status, connectionStatus, opponentConnected],
			previous,
		) => {
			setContext({
				odah_id: odahId,
				room_code: roomCode,
				is_host: isHost,
				player_slot: roomCode ? (isHost ? 1 : 2) : null,
			});
			if (status !== previous[3]) track("mm.room.status", { status });
			if (
				connectionStatus !== previous[4] ||
				opponentConnected !== previous[5]
			) {
				track("mm.presence.change", {
					connection_status: connectionStatus,
					opponent_connected: opponentConnected,
				});
			}
		},
		{
			fireImmediately: true,
			equalityFn: (a, b) => a.every((value, i) => value === b[i]),
		},
	);
}
