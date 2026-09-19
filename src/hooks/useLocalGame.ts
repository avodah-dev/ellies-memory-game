import { useShallow } from "zustand/react/shallow";
/**
 * useLocalGame - Hook for local (same-device) game mode
 *
 * This hook composes useGameController with settings management to provide
 * a complete local game experience for same-device multiplayer.
 *
 * Key principles:
 * 1. Uses useGameController for core game logic
 * 2. Reads settings from useSettingsStore (persisted via Zustand)
 * 3. Uses useUIStore for transient UI state (modals, animations, layout)
 * 4. Creates and manages EffectManager for TTS and other effects
 * 5. Provides admin controls for testing/debugging
 */

import { useCallback, useEffect, useMemo } from "react";
import { createTTSEffect, EffectManager } from "../services/effects";
import { getPlayersFromSettings } from "../services/game/GameEngine";
import { useSettingsStore, useUIStore } from "../stores";
import type { Card, GameState } from "../types";
import { calculateGridDimensions } from "../utils/gridLayout";
import { useGameController } from "./useGameController";
import { useTextToSpeech } from "./useTextToSpeech";

export interface UseLocalGameReturn {
	// State
	gameState: GameState;
	players: ReturnType<typeof getPlayersFromSettings>;
	showStartModal: boolean;
	setShowStartModal: (show: boolean) => void;
	isAnimatingCards: boolean;

	// Settings
	cardSize: number;
	autoSizeEnabled: boolean;
	useWhiteCardBackground: boolean;
	flipDuration: number;
	emojiSizePercentage: number;
	ttsEnabled: boolean;

	// Game actions
	initializeGame: (
		images: { id: string; url: string; gradient?: string }[],
		startPlaying?: boolean,
	) => void;
	startGame: (
		player1Name: string,
		player2Name: string,
		firstPlayer: number,
	) => void;
	startGameWithFirstPlayer: (firstPlayer: number) => void;
	showStartGameModal: () => void;
	flipCard: (cardId: string) => void;
	endTurn: () => void;
	resetGame: () => void;
	setFullGameState: (state: GameState) => void;
	/** Trigger game finish after final match animation completes */
	triggerGameFinish: () => void;

	// Settings actions
	updatePlayerName: (playerId: number, name: string) => void;
	updatePlayerColor: (playerId: number, color: string) => void;
	increaseCardSize: () => void;
	decreaseCardSize: () => void;
	toggleWhiteCardBackground: () => void;
	toggleAutoSize: () => void;
	increaseFlipDuration: () => void;
	decreaseFlipDuration: () => void;
	increaseEmojiSize: () => void;
	decreaseEmojiSize: () => void;
	toggleTtsEnabled: () => void;

	// Admin controls
	flipAllExceptLastPair: () => void;
	endGameEarly: () => void;
	toggleAllCardsFlipped: () => void;
	allCardsFlipped: boolean;

	// Layout
	updateAutoSizeMetrics: (metrics: {
		boardWidth: number;
		boardAvailableHeight: number;
		scoreboardHeight: number;
	}) => void;
	calculateOptimalCardSizeForCount: (
		cardCount: number,
		metricsOverride?: {
			boardWidth: number;
			boardAvailableHeight: number;
			scoreboardHeight: number;
		},
	) => void;

	// Effect manager (for sharing with online mode)
	effectManager: EffectManager;
}

export function useLocalGame(): UseLocalGameReturn {
	// ============================================
	// Settings from Zustand Store (persisted)
	// ============================================

	const settings = useSettingsStore((s) => s.settings);
	const {
		player1Name,
		player1Color,
		player2Name,
		player2Color,
		firstPlayer,
		cardSize,
		autoSizeEnabled,
		useWhiteCardBackground,
		flipDuration,
		emojiSizePercentage,
		ttsEnabled,
	} = settings;

	// Settings actions from store
	const {
		setPlayerName,
		setPlayerColor,
		setCardSize,
		setAutoSizeEnabled,
		setUseWhiteCardBackground,
		setFlipDuration,
		setEmojiSizePercentage,
		setTtsEnabled,
	} = useSettingsStore(
		useShallow((s) => ({
			setPlayerName: s.setPlayerName,
			setPlayerColor: s.setPlayerColor,
			setCardSize: s.setCardSize,
			setAutoSizeEnabled: s.setAutoSizeEnabled,
			setUseWhiteCardBackground: s.setUseWhiteCardBackground,
			setFlipDuration: s.setFlipDuration,
			setEmojiSizePercentage: s.setEmojiSizePercentage,
			setTtsEnabled: s.setTtsEnabled,
		})),
	);

	// Derive player settings for getPlayersFromSettings
	const playerSettings = useMemo(
		() => ({
			player1Name,
			player1Color,
			player2Name,
			player2Color,
		}),
		[player1Name, player1Color, player2Name, player2Color],
	);

	const players = useMemo(
		() => getPlayersFromSettings(playerSettings),
		[playerSettings],
	);

	// ============================================
	// UI State from Zustand Store (transient)
	// ============================================

	const {
		showStartModal,
		setShowStartModal,
		allCardsFlipped,
		setAllCardsFlipped,
		layoutMetrics,
		updateLayoutMetrics,
	} = useUIStore(
		useShallow((s) => ({
			showStartModal: s.showStartModal,
			setShowStartModal: s.setShowStartModal,
			allCardsFlipped: s.allCardsFlipped,
			setAllCardsFlipped: s.setAllCardsFlipped,
			layoutMetrics: s.layoutMetrics,
			updateLayoutMetrics: s.updateLayoutMetrics,
		})),
	);

	// ============================================
	// Effect Manager & TTS
	// ============================================

	const tts = useTextToSpeech();
	const effectManager = useMemo(() => new EffectManager(), []);

	useEffect(() => {
		const ttsEffect = createTTSEffect(tts, () => ttsEnabled);
		const unregister = effectManager.register(ttsEffect);
		return unregister;
	}, [effectManager, tts, ttsEnabled]);

	// ============================================
	// Game Controller
	// ============================================

	const initialGameState: GameState = {
		cards: [],
		currentPlayer: firstPlayer,
		gameStatus: "setup",
	};

	const controller = useGameController({
		mode: "local",
		initialGameState,
		initialSettings: {
			flipDuration,
			cardSize,
			autoSizeEnabled,
			useWhiteCardBackground,
			emojiSizePercentage,
			ttsEnabled,
		},
		players,
		effectManager,
	});

	// ============================================
	// Settings Actions (delegate to store)
	// ============================================

	const updatePlayerName = useCallback(
		(playerId: number, newName: string) => {
			setPlayerName(playerId, newName.trim());
		},
		[setPlayerName],
	);

	const updatePlayerColor = useCallback(
		(playerId: number, newColor: string) => {
			setPlayerColor(playerId, newColor);
		},
		[setPlayerColor],
	);

	const increaseCardSize = useCallback(() => {
		setCardSize(Math.min(cardSize + 10, 300));
	}, [cardSize, setCardSize]);

	const decreaseCardSize = useCallback(() => {
		setCardSize(Math.max(cardSize - 10, 60));
	}, [cardSize, setCardSize]);

	const toggleWhiteCardBackground = useCallback(() => {
		setUseWhiteCardBackground(!useWhiteCardBackground);
	}, [useWhiteCardBackground, setUseWhiteCardBackground]);

	const toggleAutoSize = useCallback(() => {
		setAutoSizeEnabled(!autoSizeEnabled);
	}, [autoSizeEnabled, setAutoSizeEnabled]);

	const increaseFlipDuration = useCallback(() => {
		setFlipDuration(Math.min(flipDuration + 500, 10000));
	}, [flipDuration, setFlipDuration]);

	const decreaseFlipDuration = useCallback(() => {
		setFlipDuration(Math.max(flipDuration - 500, 500));
	}, [flipDuration, setFlipDuration]);

	const increaseEmojiSize = useCallback(() => {
		setEmojiSizePercentage(Math.min(emojiSizePercentage + 5, 150));
	}, [emojiSizePercentage, setEmojiSizePercentage]);

	const decreaseEmojiSize = useCallback(() => {
		setEmojiSizePercentage(Math.max(emojiSizePercentage - 5, 20));
	}, [emojiSizePercentage, setEmojiSizePercentage]);

	const toggleTtsEnabled = useCallback(() => {
		setTtsEnabled(!ttsEnabled);
	}, [ttsEnabled, setTtsEnabled]);

	// ============================================
	// Layout Actions (delegate to store)
	// ============================================

	const updateAutoSizeMetrics = useCallback(
		(metrics: {
			boardWidth: number;
			boardAvailableHeight: number;
			scoreboardHeight: number;
		}) => {
			// Only update if values actually changed (rounded comparison)
			const roundedPrev = {
				boardWidth: Math.round(layoutMetrics.boardWidth),
				boardAvailableHeight: Math.round(layoutMetrics.boardAvailableHeight),
				scoreboardHeight: Math.round(layoutMetrics.scoreboardHeight),
			};
			const roundedNext = {
				boardWidth: Math.round(metrics.boardWidth),
				boardAvailableHeight: Math.round(metrics.boardAvailableHeight),
				scoreboardHeight: Math.round(metrics.scoreboardHeight),
			};

			if (
				roundedPrev.boardWidth !== roundedNext.boardWidth ||
				roundedPrev.boardAvailableHeight !== roundedNext.boardAvailableHeight ||
				roundedPrev.scoreboardHeight !== roundedNext.scoreboardHeight
			) {
				updateLayoutMetrics(metrics);
			}
		},
		[layoutMetrics, updateLayoutMetrics],
	);

	const calculateOptimalCardSize = useCallback(
		(
			cardCount: number,
			metricsOverride?: {
				boardWidth: number;
				boardAvailableHeight: number;
				scoreboardHeight: number;
			},
		) => {
			if (!autoSizeEnabled || cardCount === 0) {
				return Math.min(Math.max(cardSize, 60), 300);
			}

			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;

			const pairCount = Math.floor(cardCount / 2);
			const { columns, rows: gridRows } = calculateGridDimensions(pairCount);

			const horizontalPadding = 80;
			const gapSize = 8;
			const totalHorizontalGaps = (columns - 1) * gapSize;

			const metrics = metricsOverride || layoutMetrics;

			const measuredBoardWidth =
				metrics.boardWidth > 0 ? metrics.boardWidth : 0;
			const effectiveBoardWidth = Math.max(
				measuredBoardWidth || viewportWidth - horizontalPadding,
				0,
			);

			const actualRows = Math.max(gridRows, 1);
			const widthForCards = Math.max(
				effectiveBoardWidth - totalHorizontalGaps,
				columns,
			);
			const maxWidthBasedSize = Math.floor(widthForCards / columns);

			const totalVerticalGaps = (actualRows - 1) * gapSize;
			const safetyMargin = 10;

			const scoreboardReserve =
				metrics.scoreboardHeight > 0 ? metrics.scoreboardHeight + 50 : 150;

			const measuredAvailableHeight =
				metrics.boardAvailableHeight > 0
					? metrics.boardAvailableHeight
					: Math.max(viewportHeight - scoreboardReserve - 20, actualRows);

			const effectiveAvailableHeight = Math.max(
				measuredAvailableHeight - safetyMargin,
				actualRows,
			);
			const heightForCards = Math.max(
				effectiveAvailableHeight - totalVerticalGaps,
				actualRows,
			);
			const maxHeightBasedSize = Math.floor(heightForCards / actualRows);

			const optimalSize = Math.min(
				300,
				Math.max(60, Math.min(maxWidthBasedSize, maxHeightBasedSize)),
			);

			return optimalSize;
		},
		[autoSizeEnabled, cardSize, layoutMetrics],
	);

	const calculateOptimalCardSizeForCount = useCallback(
		(
			cardCount: number,
			metricsOverride?: {
				boardWidth: number;
				boardAvailableHeight: number;
				scoreboardHeight: number;
			},
		) => {
			if (!autoSizeEnabled || cardCount === 0) {
				return;
			}

			const optimalSize = calculateOptimalCardSize(cardCount, metricsOverride);
			if (optimalSize !== cardSize) {
				setCardSize(optimalSize);
			}
		},
		[autoSizeEnabled, calculateOptimalCardSize, cardSize, setCardSize],
	);

	// ============================================
	// Game Actions
	// ============================================

	const startGame = useCallback(
		(p1Name: string, p2Name: string, startingPlayer: number) => {
			// Update player names via store (colors are already stored)
			setPlayerName(1, p1Name);
			setPlayerName(2, p2Name);

			controller.setFullGameState({
				cards: [],
				currentPlayer: startingPlayer,
				gameStatus: "setup",
			});
		},
		[controller, setPlayerName],
	);

	const showStartGameModal = useCallback(() => {
		setShowStartModal(true);
	}, [setShowStartModal]);

	// ============================================
	// Admin Controls
	// ============================================

	const flipAllExceptLastPair = useCallback(() => {
		controller.setFullGameState(
			(() => {
				const prev = controller.gameState;
				if (prev.cards.length === 0) return prev;

				const lastPairImageId = prev.cards[prev.cards.length - 1]?.imageId;
				if (!lastPairImageId) return prev;

				const cardsToMatch: Card[] = [];
				prev.cards.forEach((card) => {
					if (card.imageId !== lastPairImageId && !card.isMatched) {
						cardsToMatch.push(card);
					}
				});

				const cardPairs: { [imageId: string]: Card[] } = {};
				cardsToMatch.forEach((card) => {
					if (!cardPairs[card.imageId]) {
						cardPairs[card.imageId] = [];
					}
					cardPairs[card.imageId].push(card);
				});

				const pairs = Object.values(cardPairs).filter(
					(pair) => pair.length === 2,
				);

				const cardToPlayerMap = new Map<string, number>();
				pairs.forEach((pair, index) => {
					const assignedPlayer = index % 2 === 0 ? 1 : 2;
					pair.forEach((card) => {
						cardToPlayerMap.set(card.id, assignedPlayer);
					});
				});

				const newCards = prev.cards.map((card) => {
					if (card.imageId === lastPairImageId) {
						return { ...card, isFlipped: false, isMatched: false };
					}
					if (card.isMatched) {
						return card;
					}
					const matchedByPlayerId = cardToPlayerMap.get(card.id);
					if (matchedByPlayerId !== undefined) {
						return {
							...card,
							isFlipped: true,
							isMatched: true,
							matchedByPlayerId,
						};
					}
					return card;
				});

				return { ...prev, cards: newCards };
			})(),
		);
	}, [controller]);

	const endGameEarly = useCallback(() => {
		controller.setFullGameState(
			(() => {
				const prev = controller.gameState;
				if (prev.gameStatus !== "playing" || prev.cards.length === 0) {
					return prev;
				}

				const unmatchedCards = prev.cards.filter((c) => !c.isMatched);
				const cardPairs: { [imageId: string]: Card[] } = {};
				unmatchedCards.forEach((card) => {
					if (!cardPairs[card.imageId]) {
						cardPairs[card.imageId] = [];
					}
					cardPairs[card.imageId].push(card);
				});

				const pairs = Object.values(cardPairs).filter(
					(pair) => pair.length === 2,
				);

				const lastPair = pairs[pairs.length - 1];
				const lastPairImageId = lastPair?.[0]?.imageId;

				const cardToPlayerMap = new Map<string, number>();
				const pairsToAssign = pairs.slice(0, -1);
				pairsToAssign.forEach((pair, index) => {
					const assignedPlayer = index < 10 ? 1 : 2;
					pair.forEach((card) => {
						cardToPlayerMap.set(card.id, assignedPlayer);
					});
				});

				const newCards = prev.cards.map((card) => {
					if (card.isMatched) {
						return card;
					}
					if (card.imageId === lastPairImageId) {
						return { ...card, isFlipped: false, isMatched: false };
					}
					const matchedByPlayerId = cardToPlayerMap.get(card.id);
					if (matchedByPlayerId !== undefined) {
						return {
							...card,
							isFlipped: true,
							isMatched: true,
							matchedByPlayerId,
						};
					}
					return card;
				});

				return { ...prev, cards: newCards };
			})(),
		);
	}, [controller]);

	const toggleAllCardsFlipped = useCallback(() => {
		controller.setFullGameState(
			(() => {
				const prev = controller.gameState;
				if (prev.cards.length === 0) return prev;

				const unmatchedCards = prev.cards.filter((c) => !c.isMatched);
				const currentAllFlipped =
					unmatchedCards.length > 0 && unmatchedCards.every((c) => c.isFlipped);
				const newFlippedState = !currentAllFlipped;

				setAllCardsFlipped(newFlippedState);

				const newCards = prev.cards.map((card) => {
					if (card.isMatched) {
						return card;
					}
					return { ...card, isFlipped: newFlippedState };
				});

				return { ...prev, cards: newCards };
			})(),
		);
	}, [controller, setAllCardsFlipped]);

	// ============================================
	// Return
	// ============================================

	return {
		// State
		gameState: controller.gameState,
		players,
		showStartModal,
		setShowStartModal,
		isAnimatingCards: controller.isAnimatingCards,

		// Settings
		cardSize,
		autoSizeEnabled,
		useWhiteCardBackground,
		flipDuration,
		emojiSizePercentage,
		ttsEnabled,

		// Game actions
		initializeGame: controller.initializeGame,
		startGame,
		startGameWithFirstPlayer: controller.startGameWithFirstPlayer,
		showStartGameModal,
		flipCard: controller.flipCard,
		endTurn: controller.endTurn,
		resetGame: controller.resetGame,
		setFullGameState: controller.setFullGameState,
		triggerGameFinish: controller.triggerGameFinish,

		// Settings actions
		updatePlayerName,
		updatePlayerColor,
		increaseCardSize,
		decreaseCardSize,
		toggleWhiteCardBackground,
		toggleAutoSize,
		increaseFlipDuration,
		decreaseFlipDuration,
		increaseEmojiSize,
		decreaseEmojiSize,
		toggleTtsEnabled,

		// Admin controls
		flipAllExceptLastPair,
		endGameEarly,
		toggleAllCardsFlipped,
		allCardsFlipped,

		// Layout
		updateAutoSizeMetrics,
		calculateOptimalCardSizeForCount,

		// Effect manager
		effectManager,
	};
}
