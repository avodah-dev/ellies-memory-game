import { counters } from "../services/telemetry/core";
/**
 * useCursorBroadcast - Broadcast local cursor positions without subscribing the app model
 *
 * Handles:
 * - Broadcasting local cursor position to Firebase RTDB
 * - Converting between pixel and grid-relative coordinates (0-8 for x, 0-5 for y)
 */

import { useCallback, useEffect, useRef } from "react";
import { CursorService } from "../services/sync/CursorService";

interface UseCursorBroadcastOptions {
	roomCode: string;
	localOdahId: string;
	enabled: boolean;
	cardSize: number; // Size of each card in pixels
	gap?: number; // Gap between cards in pixels (default: 8px for gap-2)
}

interface UseCursorBroadcastResult {
	/** Handler for mouse move events on the game board */
	handleMouseMove: (
		event: React.MouseEvent<HTMLDivElement>,
		boardRect: DOMRect,
	) => void;
	/** Handler for when mouse leaves the game board */
	handleMouseLeave: () => void;
}

export function useCursorBroadcast(
	options: UseCursorBroadcastOptions,
): UseCursorBroadcastResult {
	const { roomCode, localOdahId, enabled, cardSize, gap = 8 } = options;

	const cursorServiceRef = useRef<CursorService | null>(null);

	// Initialize cursor service for local player
	useEffect(() => {
		if (!enabled || !roomCode || !localOdahId) {
			return;
		}

		const service = new CursorService(roomCode, localOdahId);
		cursorServiceRef.current = service;

		service.start().catch((error) => {
			console.error(
				"[useCursorBroadcast] Failed to start cursor service:",
				error,
			);
		});

		return () => {
			service.stop().catch((error) => {
				console.error(
					"[useCursorBroadcast] Failed to stop cursor service:",
					error,
				);
			});
			cursorServiceRef.current = null;
		};
	}, [enabled, roomCode, localOdahId]);

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
		handleMouseMove,
		handleMouseLeave,
	};
}
