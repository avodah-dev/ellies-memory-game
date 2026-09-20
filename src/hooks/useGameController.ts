import { track } from "../services/telemetry/core";
import {
	stateFields,
	rememberState,
	stateApplied,
	classifyFlipRejection,
	trackBlockedFlip,
	trackFlip,
	trackFinish,
	timerStart,
	timerFire,
	timerCancel,
	cancelMatchTimer,
} from "../services/telemetry/gameplay";
import { connectionRound } from "../services/telemetry/connection";
import { debugLog } from "../utils/debugLog";
import type { GameSettings as PersistedSettings } from "../stores/settingsStore";
/**
 * useGameController - Unified hook for both local and online game modes
 *
 * This hook provides core game logic that can be used by useLocalGame and useOnlineGame,
 * using GameEngine pure functions as the single source of truth for game rules.
 *
 * Key principles:
 * 1. GameEngine handles all pure game logic (flip, match, turn switch, etc.)
 * 2. This hook handles orchestration (animation timing, side effects, sync)
 * 3. Online mode uses authority pattern - only current player runs game logic
 * 4. EffectManager handles side effects (TTS, sounds) in a pluggable way
 */

import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { EffectManager } from "../services/effects/EffectManager";
import {
	applyMatch,
	applyNoMatchWithReset,
	calculateWinner,
	canFlipCard,
	checkMatch,
	endTurn as engineEndTurn,
	flipCard as engineFlipCard,
	finishGame,
	initializeCards,
	checkAndFinishGame,
	getPlayerById,
	isGameOver,
} from "../services/game/GameEngine";
import { useGameSynchronization } from "./useGameSynchronization";
import type { ISyncAdapter } from "../services/sync/ISyncAdapter";
import type { Card, GameState, OnlineGameState, Player } from "../types";

// ============================================
// Types
// ============================================

export type GameSettings = Pick<
	PersistedSettings,
	| "flipDuration"
	| "cardSize"
	| "autoSizeEnabled"
	| "useWhiteCardBackground"
	| "emojiSizePercentage"
	| "ttsEnabled"
>;

export interface LayoutMetrics {
	boardWidth: number;
	boardAvailableHeight: number;
	scoreboardHeight: number;
}

export interface UseGameControllerOptions {
	/** Game mode: 'local' for same-device, 'online' for networked */
	mode: "local" | "online";

	/** Initial game state */
	initialGameState: GameState;

	/** Initial settings */
	initialSettings: GameSettings;

	/** Players array (derived from settings for local, presence for online) */
	players: Player[];

	/** Effect manager for side effects (TTS, sounds) */
	effectManager?: EffectManager;

	// Online mode options
	/** Sync adapter for online mode (Firestore) */
	syncAdapter?: ISyncAdapter;
	/** Local player's slot (1 or 2) for online mode */
	localPlayerSlot?: number;
	/** Room code for online mode */
	roomCode?: string;
	onlineReady?: boolean;
}

export interface GameControllerReturn {
	// State
	gameState: GameState;
	settings: GameSettings;
	layoutMetrics: LayoutMetrics;
	isAnimating: boolean;
	isAuthoritative: boolean;
	isAnimatingCards: boolean;
	syncError: string | null;
	resynchronize: () => Promise<void>;

	// Actions
	flipCard: (cardId: string) => void;
	endTurn: () => void;
	resetGame: () => void;
	setFullGameState: (state: GameState) => void;
	initializeGame: (
		images: { id: string; url: string; gradient?: string }[],
		startPlaying?: boolean,
	) => void;
	startGame: () => void;
	startGameWithFirstPlayer: (firstPlayer: number) => void;
	/** Trigger game finish after final match animation completes */
	triggerGameFinish: () => void;

	// Player management

	// Settings management
	updateSettings: (settings: Partial<GameSettings>) => void;
	updateLayoutMetrics: (metrics: LayoutMetrics) => void;

	// Admin/Debug controls
	toggleAllCardsFlipped: () => void;
	endGameEarly: () => void;

	// Utilities
	calculateOptimalCardSize: (cardCount: number) => number;
}

// ============================================
// Constants
// ============================================

// ============================================
// Helpers
// ============================================

/**
 * Convert imageId to human-readable card name for TTS
 * e.g. "african-elephant" -> "African Elephant"
 */
const formatCardNameForSpeech = (imageId: string): string => {
	return imageId
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
};

// ============================================
// Hook Implementation
// ============================================

export function useGameController(
	options: UseGameControllerOptions,
): GameControllerReturn {
	const {
		mode,
		initialGameState,
		initialSettings,
		players,
		effectManager,
		syncAdapter,
		localPlayerSlot,
		roomCode,
		onlineReady = true,
	} = options;

	// ============================================
	// State
	// ============================================

	const [gameState, reactSetGameState] = useState<GameState>(initialGameState);
	const stateRef = useRef(initialGameState);
	const setGameState = useCallback(
		(value: GameState | ((state: GameState) => GameState)) => {
			const next =
				typeof value === "function" ? value(stateRef.current) : value;
			stateRef.current = next;
			stateApplied(next, "controller");
			reactSetGameState(next);
		},
		[],
	);
	const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [settings, setSettings] = useState<GameSettings>(initialSettings);
	const [layoutMetrics, setLayoutMetrics] = useState<LayoutMetrics>({
		boardWidth: 0,
		boardAvailableHeight: 0,
		scoreboardHeight: 0,
	});
	const [isAnimating, setIsAnimating] = useState(false);
	const [isAnimatingCards, setIsAnimatingCards] = useState(false);

	// ============================================
	// Refs
	// ============================================

	const matchCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const isCheckingMatchRef = useRef(false);

	// Players ref - always kept in sync to avoid stale closure issues with TTS
	const playersRef = useRef(players);
	playersRef.current = players;

	// ============================================
	// Computed Values
	// ============================================

	const isOnlineMode = mode === "online";
	useLayoutEffect(() => {
		rememberState(gameState);
		connectionRound(roomCode, gameState);
		track("mm.game.state", {
			...stateFields(gameState),
			phase: "committed",
			mode,
			local_slot: localPlayerSlot ?? null,
			online_ready: onlineReady,
		});
	}, [gameState, roomCode, mode, localPlayerSlot, onlineReady]);
	const isAuthoritative =
		!isOnlineMode || localPlayerSlot === gameState.currentPlayer;

	// ============================================
	// Sync Helper (Online mode)
	// ============================================

	const {
		syncError,
		resynchronize,
		syncToFirestore,
		pausedRef,
		generation,
		lastSyncedVersionRef,
		localVersionRef,
		lastGameRoundRef,
	} = useGameSynchronization({
		isOnlineMode,
		syncAdapter,
		roomCode,
		localPlayerSlot,
		onlineReady,
		gameState,
		initialGameState,
		setGameState,
		matchCheckTimeoutRef,
		isCheckingMatchRef,
	});
	useEffect(
		() => () => {
			if (animationTimer.current) clearTimeout(animationTimer.current);
		},
		[],
	);

	// ============================================
	// Actions - endTurn (defined early for use in useEffect)
	// ============================================

	const endTurn = useCallback(() => {
		track("mm.game.endturn", {
			...stateFields(stateRef.current),
			result: pausedRef.current
				? "paused"
				: !onlineReady
					? "not-ready"
					: isOnlineMode && localPlayerSlot !== stateRef.current.currentPlayer
						? "not-your-turn"
						: "accepted",
		});
		if (
			pausedRef.current ||
			!onlineReady ||
			(isOnlineMode && localPlayerSlot !== stateRef.current.currentPlayer)
		)
			return;
		cancelMatchTimer(matchCheckTimeoutRef, "end-turn");
		// Clear any pending match check
		if (matchCheckTimeoutRef.current) {
			clearTimeout(matchCheckTimeoutRef.current);
			matchCheckTimeoutRef.current = null;
		}
		isCheckingMatchRef.current = false;

		// Use GameEngine to end turn
		const newState = engineEndTurn(stateRef.current);
		setGameState(newState);

		if (isOnlineMode) {
			syncToFirestore(newState, "endTurn");
		}

		// Notify turn change (use ref to always get latest player names)
		const nextPlayerId = newState.currentPlayer;
		const nextPlayerName =
			getPlayerById(playersRef.current, nextPlayerId)?.name ||
			`Player ${nextPlayerId}`;
		effectManager?.notifyTurnChange(nextPlayerName, nextPlayerId);
	}, [
		isOnlineMode,
		localPlayerSlot,
		onlineReady,
		syncToFirestore,
		effectManager,
		setGameState,
		pausedRef,
	]);

	// ============================================
	// Match Check Logic
	// ============================================

	const checkForMatch = useCallback(
		(_selectedIds: string[], currentState: GameState) => {
			// Double-check authority
			if (isOnlineMode && localPlayerSlot !== currentState.currentPlayer) {
				track("mm.game.match", {
					...stateFields(currentState),
					result: "lost-authority",
				});
				console.warn("[MATCH CHECK] Lost authority, aborting");
				return;
			}

			isCheckingMatchRef.current = true;

			const matchResult = checkMatch(currentState);
			if (!matchResult) {
				track("mm.game.match", {
					...stateFields(currentState),
					result: "missing-selected",
				});
				console.error("[MATCH CHECK] Could not find selected cards");
				isCheckingMatchRef.current = false;
				return;
			}

			const { isMatch, firstCard, secondCard } = matchResult;
			track("mm.game.match", {
				...stateFields(currentState),
				result: isMatch ? "match" : "mismatch",
			});
			const cardIds: [string, string] = [firstCard.id, secondCard.id];
			const currentPlayerId = currentState.currentPlayer;
			// Use ref to always get latest player names
			const currentPlayerName =
				getPlayerById(playersRef.current, currentPlayerId)?.name ||
				`Player ${currentPlayerId}`;

			if (isMatch) {
				// Apply match directly - animation is handled locally by GameBoard
				// Completion is authoritative immediately; the UI owns its transition delay.
				const matchedState = checkAndFinishGame(
					applyMatch(currentState, matchResult),
				);

				trackFinish(matchedState);
				setGameState(matchedState);
				if (isOnlineMode) {
					syncToFirestore(matchedState, `match:complete`);
				}

				// Notify effect manager (TTS will announce match with card name)
				const matchedCardName = formatCardNameForSpeech(firstCard.imageId);
				effectManager?.notifyMatchFound(
					currentPlayerName,
					currentPlayerId,
					matchedCardName,
				);

				// Check if this was the final match - notify game over effects
				if (isGameOver(matchedState)) {
					const { winner, isTie } = calculateWinner(
						matchedState.cards,
						playersRef.current,
					);
					effectManager?.notifyGameOver(winner, isTie);
				}

				isCheckingMatchRef.current = false;
			} else {
				// No match - flip back and switch turns
				const noMatchState = applyNoMatchWithReset(currentState, cardIds);

				setGameState(noMatchState);
				if (isOnlineMode) {
					syncToFirestore(noMatchState, `noMatch`);
				}

				// Notify effect manager of turn change (use ref for latest names)
				const nextPlayerId = noMatchState.currentPlayer;
				const nextPlayerName =
					getPlayerById(playersRef.current, nextPlayerId)?.name ||
					`Player ${nextPlayerId}`;
				effectManager?.notifyTurnChange(nextPlayerName, nextPlayerId);

				isCheckingMatchRef.current = false;
			}
		},
		[
			isOnlineMode,
			localPlayerSlot,
			syncToFirestore,
			effectManager,
			setGameState,
		],
	);

	// ============================================
	// Actions
	// ============================================

	const flipCard = useCallback(
		(cardId: string) => {
			const gameState = stateRef.current;
			if (pausedRef.current || !onlineReady) {
				trackBlockedFlip(
					gameState,
					cardId,
					pausedRef.current,
					onlineReady,
					isCheckingMatchRef.current,
					localPlayerSlot,
					mode,
				);
				return;
			}
			// Online mode: strict turn enforcement
			if (isOnlineMode && localPlayerSlot !== gameState.currentPlayer) {
				trackFlip(
					gameState,
					cardId,
					"not-your-turn",
					pausedRef.current,
					onlineReady,
					isCheckingMatchRef.current,
					localPlayerSlot,
					mode,
				);
				debugLog("[FLIP] Not your turn");
				return;
			}

			// Prevent during match check
			if (isCheckingMatchRef.current) {
				trackFlip(
					gameState,
					cardId,
					"checking-match",
					pausedRef.current,
					onlineReady,
					isCheckingMatchRef.current,
					localPlayerSlot,
					mode,
				);
				debugLog("[FLIP] Match check in progress");
				return;
			}

			// Validate flip using GameEngine
			if (!canFlipCard(gameState, cardId)) {
				trackFlip(
					gameState,
					cardId,
					classifyFlipRejection(gameState, cardId),
					pausedRef.current,
					onlineReady,
					isCheckingMatchRef.current,
					localPlayerSlot,
					mode,
				);
				return;
			}

			trackFlip(
				gameState,
				cardId,
				"accepted",
				pausedRef.current,
				onlineReady,
				isCheckingMatchRef.current,
				localPlayerSlot,
				mode,
			);
			// Apply flip using GameEngine
			const newState = engineFlipCard(gameState, cardId);
			setGameState(newState);

			// Sync immediately in online mode
			if (isOnlineMode) {
				syncToFirestore(newState, `flip:${cardId}`);
			}
		},
		[
			isOnlineMode,
			localPlayerSlot,
			onlineReady,
			setGameState,
			pausedRef,
			mode,
			syncToFirestore,
		],
	);

	useEffect(() => {
		if (
			!isAuthoritative ||
			!onlineReady ||
			syncError ||
			gameState.gameStatus !== "playing"
		)
			return;
		if (gameState.cards.filter((c) => c.isFlipped && !c.isMatched).length !== 2)
			return;
		isCheckingMatchRef.current = true;
		const timerTrace = timerStart(
			"match",
			stateRef.current,
			settings.flipDuration,
			matchCheckTimeoutRef,
		);
		matchCheckTimeoutRef.current = setTimeout(() => {
			timerFire(timerTrace);
			matchCheckTimeoutRef.current = null;
			checkForMatch([], stateRef.current);
		}, settings.flipDuration);
		return () => {
			timerCancel(timerTrace, "effect-cleanup");
			if (matchCheckTimeoutRef.current)
				clearTimeout(matchCheckTimeoutRef.current);
			matchCheckTimeoutRef.current = null;
			isCheckingMatchRef.current = false;
		};
	}, [
		gameState.cards,
		gameState.gameStatus,
		isAuthoritative,
		onlineReady,
		syncError,
		settings.flipDuration,
		checkForMatch,
	]);
	const resetGame = useCallback(() => {
		cancelMatchTimer(matchCheckTimeoutRef, "reset");
		// Clear timeouts
		if (matchCheckTimeoutRef.current) {
			clearTimeout(matchCheckTimeoutRef.current);
			matchCheckTimeoutRef.current = null;
		}
		isCheckingMatchRef.current = false;
		++generation.current;
		track("mm.sync.epoch", {
			epoch: generation.current,
			reason: "controller-reset-or-full-state",
		});
		if (animationTimer.current) clearTimeout(animationTimer.current);
		setIsAnimating(false);
		setIsAnimatingCards(false);
	}, [generation]);

	const setFullGameState = useCallback(
		(newState: GameState) => {
			++generation.current;
			setGameState(newState);

			if (isOnlineMode) {
				const onlineState = newState as OnlineGameState;
				const version = onlineState.syncVersion || 0;
				const gameRound = onlineState.gameRound || 0;
				lastSyncedVersionRef.current = version;
				localVersionRef.current = version;
				lastGameRoundRef.current = gameRound;
			}
		},
		[
			isOnlineMode,
			setGameState,
			generation,
			lastSyncedVersionRef,
			localVersionRef,
			lastGameRoundRef,
		],
	);

	const initializeGame = useCallback(
		(
			images: { id: string; url: string; gradient?: string }[],
			startPlaying: boolean = false,
		) => {
			cancelMatchTimer(matchCheckTimeoutRef, "initialize");
			// Cancel any pending match check
			if (matchCheckTimeoutRef.current) {
				clearTimeout(matchCheckTimeoutRef.current);
				matchCheckTimeoutRef.current = null;
			}
			isCheckingMatchRef.current = false;

			if (animationTimer.current) clearTimeout(animationTimer.current);
			const shuffledCards = initializeCards(images);

			if (startPlaying) {
				// Start animation sequence
				setIsAnimatingCards(true);
				setIsAnimating(true);
				setGameState((prev) => ({
					...prev,
					cards: shuffledCards,
					gameStatus: "playing",
				}));

				// After animation completes, mark animation as done
				// 900ms per card animation + 30ms delay between cards
				const totalAnimationTime = shuffledCards.length * 30 + 900;
				animationTimer.current = setTimeout(() => {
					setIsAnimatingCards(false);
					setIsAnimating(false);
				}, totalAnimationTime);
			} else {
				setGameState((prev) => ({
					...prev,
					cards: shuffledCards,
					gameStatus: "setup",
				}));
			}
		},
		[setGameState],
	);

	const startGame = useCallback(() => {
		setGameState((prev) => ({
			...prev,
			gameStatus: "playing",
		}));
		setIsAnimating(false);

		// Notify game start (use ref to always get latest player names)
		const firstPlayerId = gameState.currentPlayer;
		const firstPlayerName =
			getPlayerById(playersRef.current, firstPlayerId)?.name ||
			`Player ${firstPlayerId}`;
		effectManager?.notifyGameStart(firstPlayerName, firstPlayerId);
	}, [gameState.currentPlayer, effectManager, setGameState]);

	const startGameWithFirstPlayer = useCallback(
		(firstPlayer: number) => {
			// Use ref to always get latest player names
			const firstPlayerName =
				getPlayerById(playersRef.current, firstPlayer)?.name ||
				`Player ${firstPlayer}`;

			// Notify effects (TTS will announce first player's turn)
			effectManager?.notifyGameStart(firstPlayerName, firstPlayer);

			setGameState((prev) => ({
				...prev,
				currentPlayer: firstPlayer,
				gameStatus: "playing" as const,
			}));

			// Note: firstPlayer preference is persisted via useSettingsStore in useLocalGame
		},
		[effectManager, setGameState],
	);

	/**
	 * Trigger game finish - called by GameBoard after final match animation completes.
	 * This sets gameStatus to 'finished' which triggers the GameOver modal.
	 */
	const triggerGameFinish = useCallback(() => {
		// In online mode, only the authoritative player should trigger game finish
		// This prevents race conditions where both players try to sync state
		if (isOnlineMode && !isAuthoritative) {
			debugLog("[GAME FINISH] Ignoring - not authoritative player");
			return;
		}

		// Only finish if all cards are matched (sanity check)
		if (!isGameOver(gameState)) {
			console.warn(
				"[GAME FINISH] triggerGameFinish called but game is not over",
			);
			return;
		}

		debugLog(
			"[GAME FINISH] Animation complete, setting game status to finished",
		);
		const finishedState = finishGame(gameState);
		setGameState(finishedState);

		if (isOnlineMode) {
			syncToFirestore(finishedState, "gameFinish:afterAnimation");
		}
	}, [isOnlineMode, isAuthoritative, gameState, syncToFirestore, setGameState]);

	// ============================================
	// Player Management
	// Note: Player names/colors are now managed via useSettingsStore.
	// These are no-ops kept for API compatibility - actual updates
	// should be done via useLocalGame.updatePlayerName/Color which
	// delegates to the settings store.
	// ============================================

	// ============================================
	// Settings Management
	// Note: Settings are now persisted via useSettingsStore in useLocalGame.
	// This function updates local state for the controller but does NOT
	// persist to localStorage - that's handled by the store.
	// ============================================

	const updateSettings = useCallback((newSettings: Partial<GameSettings>) => {
		setSettings((prev) => ({ ...prev, ...newSettings }));
	}, []);

	const updateLayoutMetrics = useCallback((metrics: LayoutMetrics) => {
		setLayoutMetrics((prev) => {
			// Only update if values actually changed (prevent re-renders)
			if (
				Math.round(prev.boardWidth) === Math.round(metrics.boardWidth) &&
				Math.round(prev.boardAvailableHeight) ===
					Math.round(metrics.boardAvailableHeight) &&
				Math.round(prev.scoreboardHeight) ===
					Math.round(metrics.scoreboardHeight)
			) {
				return prev;
			}
			return metrics;
		});
	}, []);

	// ============================================
	// Admin/Debug Controls
	// ============================================

	const toggleAllCardsFlipped = useCallback(() => {
		if (import.meta.env.MODE === "production" || isOnlineMode) return;
		if (gameState.cards.length === 0) return;

		const unmatchedCards = gameState.cards.filter((c) => !c.isMatched);
		if (unmatchedCards.length === 0) return;

		const allFlipped = unmatchedCards.every((c) => c.isFlipped);
		const newFlippedState = !allFlipped;

		const newCards = gameState.cards.map((card) => {
			if (card.isMatched) {
				return card;
			}
			return { ...card, isFlipped: newFlippedState };
		});

		const newState: GameState = {
			...gameState,
			cards: newCards,
		};

		setGameState(newState);
		if (isOnlineMode) {
			syncToFirestore(
				newState,
				newFlippedState ? "admin:revealAll" : "admin:hideAll",
			);
		}
	}, [gameState, isOnlineMode, syncToFirestore, setGameState]);

	const endGameEarly = useCallback(() => {
		if (import.meta.env.MODE === "production" || isOnlineMode) return;
		if (gameState.gameStatus !== "playing" || gameState.cards.length === 0) {
			return;
		}

		// Set up test state: Player 1 gets 10 matches, Player 2 gets 9 matches
		// This leaves 1 pair (2 cards) unmatched for easy testing

		// Get all unmatched cards
		const unmatchedCards = gameState.cards.filter((c) => !c.isMatched);

		// Group unmatched cards by imageId to get pairs
		const cardPairs: { [imageId: string]: Card[] } = {};
		unmatchedCards.forEach((card) => {
			if (!cardPairs[card.imageId]) {
				cardPairs[card.imageId] = [];
			}
			cardPairs[card.imageId].push(card);
		});

		// Get complete pairs only (should be exactly 2 cards each)
		const pairs = Object.values(cardPairs).filter((pair) => pair.length === 2);

		// Find the last pair to leave unmatched
		const lastPair = pairs[pairs.length - 1];
		const lastPairImageId = lastPair?.[0]?.imageId;

		// Create a map of card ID to assigned player ID
		const cardToPlayerMap = new Map<string, number>();

		// Distribute pairs: 10 to Player 1, 9 to Player 2
		// Skip the last pair (leave it unmatched)
		const pairsToAssign = pairs.slice(0, -1);
		pairsToAssign.forEach((pair, index) => {
			// First 10 pairs go to Player 1, next 9 pairs go to Player 2
			const assignedPlayer = index < 10 ? 1 : 2;
			pair.forEach((card) => {
				cardToPlayerMap.set(card.id, assignedPlayer);
			});
		});

		// Update cards
		const newCards = gameState.cards.map((card) => {
			// Keep already matched cards as is
			if (card.isMatched) {
				return card;
			}

			// Keep the last pair unflipped and unmatched
			if (card.imageId === lastPairImageId) {
				return { ...card, isFlipped: false, isMatched: false };
			}

			// Check if this card should be matched
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

		// Keep game in "playing" status so user can complete the final match
		const newState: GameState = {
			...gameState,
			cards: newCards,
		};

		setGameState(newState);
		if (isOnlineMode) {
			syncToFirestore(newState, "admin:endGameEarly");
		}
	}, [gameState, isOnlineMode, syncToFirestore, setGameState]);

	// ============================================
	// Utilities
	// ============================================

	const calculateOptimalCardSize = useCallback(
		(cardCount: number): number => {
			if (!settings.autoSizeEnabled || cardCount === 0) {
				return settings.cardSize;
			}

			const { boardWidth, boardAvailableHeight } = layoutMetrics;
			if (boardWidth === 0 || boardAvailableHeight === 0) {
				return settings.cardSize;
			}

			// Calculate optimal grid dimensions
			const aspectRatio = boardWidth / boardAvailableHeight;
			let bestSize = 0;

			for (let cols = 1; cols <= cardCount; cols++) {
				const rows = Math.ceil(cardCount / cols);
				const gridRatio = cols / rows;

				// Skip if grid aspect ratio is too different from container
				if (Math.abs(gridRatio - aspectRatio) > 1) continue;

				const maxCardWidth = (boardWidth - (cols + 1) * 8) / cols;
				const maxCardHeight = (boardAvailableHeight - (rows + 1) * 8) / rows;
				const size = Math.min(maxCardWidth, maxCardHeight);

				if (size > bestSize) {
					bestSize = size;
				}
			}

			// Clamp to reasonable range
			return Math.max(60, Math.min(200, Math.floor(bestSize)));
		},
		[settings.autoSizeEnabled, settings.cardSize, layoutMetrics],
	);

	// ============================================
	// Return
	// ============================================

	return {
		// State
		syncError,
		resynchronize,
		gameState,
		settings,
		layoutMetrics,
		isAnimating,
		isAuthoritative,
		isAnimatingCards,

		// Actions
		flipCard,
		endTurn,
		resetGame,
		setFullGameState,
		initializeGame,
		startGame,
		startGameWithFirstPlayer,
		triggerGameFinish,

		// Player management

		// Settings management
		updateSettings,
		updateLayoutMetrics,

		// Admin/Debug controls
		toggleAllCardsFlipped,
		endGameEarly,

		// Utilities
		calculateOptimalCardSize,
	};
}
