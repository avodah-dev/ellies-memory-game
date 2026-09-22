import { useEffect, useState } from "react";
import { CursorService } from "../../services/sync/CursorService";
import { counters } from "../../services/telemetry/core";
import type { CursorPosition } from "../../types";
import { RemoteCursor } from "./RemoteCursor";

export interface CursorPeer {
	roomCode: string;
	opponentOdahId: string;
	playerName: string;
	playerColor: string;
}

// GameBoard keys this leaf by room + opponent identity. A new peer mounts with
// no position; old subscription callbacks cannot restore a departed cursor.
export function OpponentCursor({
	roomCode,
	opponentOdahId,
	playerName,
	playerColor,
	cardSize,
	gap,
}: CursorPeer & { cardSize: number; gap: number }) {
	const [position, setPosition] = useState<CursorPosition | null>(null);
	useEffect(() => {
		let active = true;
		const stop = CursorService.subscribeToCursor(
			roomCode,
			opponentOdahId,
			(next) => {
				if (!active) return;
				counters.cursorRx++;
				setPosition(next);
			},
		);
		return () => {
			active = false;
			stop();
		};
	}, [roomCode, opponentOdahId]);
	if (!position) return null;
	return (
		<RemoteCursor
			position={position}
			cardSize={cardSize}
			gap={gap}
			playerName={playerName}
			playerColor={playerColor}
		/>
	);
}
