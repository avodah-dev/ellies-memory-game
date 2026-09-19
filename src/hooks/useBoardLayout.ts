import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { GameState } from "../types";
import type { LayoutMetrics } from "../stores/uiStore";
interface Options {
	autoSizeEnabled: boolean;
	gameState: GameState;
	currentPath: string;
	boardWrapperRef: RefObject<HTMLDivElement | null>;
	scoreboardRef: RefObject<HTMLDivElement | null>;
	gameBoardContainerRef: RefObject<HTMLDivElement | null>;
	updateAutoSizeMetrics: (metrics: LayoutMetrics) => void;
	calculateOptimalCardSizeForCount: (
		count: number,
		metrics?: LayoutMetrics,
	) => void;
}
const AUTOSIZE_DEBOUNCE_MS = 100;
export function useBoardLayout({
	autoSizeEnabled,
	gameState,
	currentPath,
	boardWrapperRef,
	scoreboardRef,
	gameBoardContainerRef,
	updateAutoSizeMetrics,
	calculateOptimalCardSizeForCount,
}: Options) {
	const layoutMeasureRafRef = useRef<number | null>(null);
	const resizeRecalcDebounceRef = useRef<number | null>(null);
	const computeLayoutMetrics = useCallback(() => {
		if (!autoSizeEnabled) {
			const emptyMetrics = {
				boardWidth: 0,
				boardAvailableHeight: 0,
				scoreboardHeight: 0,
			};
			updateAutoSizeMetrics(emptyMetrics);
			return emptyMetrics;
		}

		const wrapperWidth =
			boardWrapperRef.current?.getBoundingClientRect().width ?? 0;
		const scoreboardHeight =
			scoreboardRef.current?.getBoundingClientRect().height ?? 0;
		const boardRect = gameBoardContainerRef.current?.getBoundingClientRect();
		const bottomPadding = 24;
		const boardAvailableHeight = boardRect
			? Math.max(window.innerHeight - boardRect.top - bottomPadding, 0)
			: Math.max(window.innerHeight - (scoreboardHeight + bottomPadding), 0);

		const metrics = {
			boardWidth: wrapperWidth,
			boardAvailableHeight,
			scoreboardHeight,
		};

		// Update state for future use
		updateAutoSizeMetrics(metrics);

		// Return metrics synchronously for immediate use
		return metrics;
	}, [
		autoSizeEnabled,
		updateAutoSizeMetrics,
		boardWrapperRef,
		scoreboardRef,
		gameBoardContainerRef,
	]);

	useEffect(() => {
		if (!autoSizeEnabled) {
			updateAutoSizeMetrics({
				boardWidth: 0,
				boardAvailableHeight: 0,
				scoreboardHeight: 0,
			});
			return;
		}

		const triggerMeasure = () => {
			if (layoutMeasureRafRef.current) {
				cancelAnimationFrame(layoutMeasureRafRef.current);
			}
			layoutMeasureRafRef.current = requestAnimationFrame(() => {
				computeLayoutMetrics();
			});
		};

		triggerMeasure();

		const resizeObserver = new ResizeObserver(triggerMeasure);
		if (boardWrapperRef.current)
			resizeObserver.observe(boardWrapperRef.current);
		if (scoreboardRef.current) resizeObserver.observe(scoreboardRef.current);
		if (gameBoardContainerRef.current)
			resizeObserver.observe(gameBoardContainerRef.current);

		window.addEventListener("resize", triggerMeasure);

		return () => {
			if (layoutMeasureRafRef.current) {
				cancelAnimationFrame(layoutMeasureRafRef.current);
			}
			resizeObserver.disconnect();
			window.removeEventListener("resize", triggerMeasure);
		};
	}, [
		autoSizeEnabled,
		computeLayoutMetrics,
		updateAutoSizeMetrics,
		boardWrapperRef,
		scoreboardRef,
		gameBoardContainerRef,
	]);

	// Debounced card size recalculation on window resize
	// This is separate from the layout metrics effect - that one updates metrics,
	// this one actually recalculates card size based on new container dimensions
	useEffect(() => {
		if (
			!autoSizeEnabled ||
			gameState.cards.length === 0 ||
			gameState.gameStatus !== "playing"
		) {
			return;
		}

		const recalculateCardSize = () => {
			// Clear any pending debounce
			if (resizeRecalcDebounceRef.current) {
				clearTimeout(resizeRecalcDebounceRef.current);
			}

			// Debounce to wait for resize to settle
			resizeRecalcDebounceRef.current = window.setTimeout(() => {
				const metrics = computeLayoutMetrics();
				if (metrics.boardWidth > 0) {
					calculateOptimalCardSizeForCount(gameState.cards.length, metrics);
				}
			}, AUTOSIZE_DEBOUNCE_MS);
		};

		window.addEventListener("resize", recalculateCardSize);

		return () => {
			if (resizeRecalcDebounceRef.current) {
				clearTimeout(resizeRecalcDebounceRef.current);
			}
			window.removeEventListener("resize", recalculateCardSize);
		};
	}, [
		autoSizeEnabled,
		gameState.cards.length,
		gameState.gameStatus,
		computeLayoutMetrics,
		calculateOptimalCardSizeForCount,
	]);

	// Auto-size when cards appear (works for both local and online modes)
	// This is needed because useLocalGame's internal effect only sees its own gameState,
	// but in online mode the cards are in onlineGame.gameState
	useEffect(() => {
		// Only run when on a game route where the game board DOM exists
		const isOnGameRoute =
			currentPath === "/local/game" || currentPath === "/online/game";

		if (!autoSizeEnabled || gameState.cards.length === 0 || !isOnGameRoute) {
			return;
		}

		let retryTimeoutId: number | null = null;

		// Delay to ensure layout is rendered, especially for guests joining online games
		// Use requestAnimationFrame to ensure DOM is ready before measuring
		const timeoutId = setTimeout(() => {
			requestAnimationFrame(() => {
				const metrics = computeLayoutMetrics();

				// Only proceed if we got valid measurements
				if (metrics.boardWidth > 0 && metrics.boardAvailableHeight > 0) {
					calculateOptimalCardSizeForCount(gameState.cards.length, metrics);
				} else {
					// Retry after another delay if measurements aren't ready
					retryTimeoutId = window.setTimeout(() => {
						const retryMetrics = computeLayoutMetrics();
						calculateOptimalCardSizeForCount(
							gameState.cards.length,
							retryMetrics,
						);
					}, 100);
				}
			});
		}, AUTOSIZE_DEBOUNCE_MS);

		return () => {
			clearTimeout(timeoutId);
			if (retryTimeoutId) {
				clearTimeout(retryTimeoutId);
			}
		};
	}, [
		autoSizeEnabled,
		gameState.cards.length,
		currentPath,
		computeLayoutMetrics,
		calculateOptimalCardSizeForCount,
	]);
}
