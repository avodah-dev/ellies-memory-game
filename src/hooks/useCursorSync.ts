import { counters } from "../services/telemetry/core";
/**
 * useCursorSync - Hook for syncing cursor positions in online mode
 *
 * Handles:
 * - Broadcasting local cursor position to Firebase RTDB
 * - Subscribing to opponent's cursor position
 * - Converting between pixel and grid-relative coordinates (0-8 for x, 0-5 for y)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CursorService } from "../services/sync/CursorService";
import type { CursorPosition } from "../types";

interface UseCursorSyncOptions {
	roomCode: string;
	localOdahId: string;
	opponentOdahId: string | null;
	enabled: boolean;
	cardSize: number; // Size of each card in pixels
	gap?: number; // Gap between cards in pixels (default: 8px for gap-2)
}

interface UseCursorSyncResult {
	/** Opponent's cursor position (grid-relative: 0-8 for x, 0-5 for y) */
	opponentCursor: CursorPosition | null;
	/** Handler for mouse move events on the game board */
	handleMouseMove: (
		event: React.MouseEvent<HTMLDivElement>,
		boardRect: DOMRect,
	) => void;
	/** Handler for when mouse leaves the game board */
	handleMouseLeave: () => void;
}

export function useCursorSync(
	options: UseCursorSyncOptions,
): UseCursorSyncResult {
	const {
		roomCode,
		localOdahId,
		opponentOdahId,
		enabled,
		cardSize,
		gap = 8,
	} = options;

	const [opponentCursor, setOpponentCursor] = useState<CursorPosition | null>(
		null,
	);
	const cursorServiceRef = useRef<CursorService | null>(null);

	// Initialize cursor service for local player
	useEffect(() => {
		if (!enabled || !roomCode || !localOdahId) {
			return;
		}

		const service = new CursorService(roomCode, localOdahId);
		cursorServiceRef.current = service;

		service.start().catch((error) => {
			console.error("[useCursorSync] Failed to start cursor service:", error);
		});

		return () => {
			service.stop().catch((error) => {
				console.error("[useCursorSync] Failed to stop cursor service:", error);
			});
			cursorServiceRef.current = null;
		};
	}, [enabled, roomCode, localOdahId]);

	// Subscribe to opponent's cursor
	useEffect(() => {
		if (!enabled || !roomCode || !opponentOdahId) {
			setOpponentCursor(null);
			return;
		}

		const unsubscribe = CursorService.subscribeToCursor(
			roomCode,
			opponentOdahId,
			(position) => {
				counters.cursorRx++;
				setOpponentCursor(position);
			},
		);

		return () => {
			unsubscribe();
			setOpponentCursor(null);
		};
	}, [enabled, roomCode, opponentOdahId]);

	// Handle mouse move - convert pixel position to grid-relative coordinates
	const handleMouseMove = useCallback(
		(event: React.MouseEvent<HTMLDivElement>, boardRect: DOMRect) => {
			if (!cursorServiceRef.current || !enabled) return;

			// Position relative to the board
			const relX = event.clientX - boardRect.left;
			const relY = event.clientY - boardRect.top;

			// Convert to grid position (0-8 for cols, 0-5 for rows)
			// Each grid cell is cardSize + gap wide/tall
			const gridX = relX / (cardSize + gap);
			const gridY = relY / (cardSize + gap);

			// Only send if within grid bounds (8 columns, 5 rows)
			if (gridX >= 0 && gridX <= 8 && gridY >= 0 && gridY <= 5) {
				counters.cursorTx++;
				cursorServiceRef.current.updatePosition(gridX, gridY);
			} else {
				// Clear position if outside grid bounds
				cursorServiceRef.current.clearPosition();
			}
		},
		[enabled, cardSize, gap],
	);

	// Handle mouse leave - clear cursor position
	const handleMouseLeave = useCallback(() => {
		if (!cursorServiceRef.current || !enabled) return;
		cursorServiceRef.current.clearPosition();
	}, [enabled]);

	return {
		opponentCursor,
		handleMouseMove,
		handleMouseLeave,
	};
}
