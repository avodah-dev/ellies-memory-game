import { useShallow } from "zustand/react/shallow";
import { debugLog } from "../utils/debugLog";
import { useBoardLayout } from "./useBoardLayout";
import { useFullscreen } from "./useFullscreen";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { CARD_DECKS } from "../data/cardDecks";
import {
	BACKGROUND_OPTIONS,
	type BackgroundTheme,
	useBackgroundSelector,
} from "../hooks/useBackgroundSelector";
import {
	CARD_BACK_OPTIONS,
	type CardBackType,
	useCardBackSelector,
} from "../hooks/useCardBackSelector";
import { useCardPacks } from "../hooks/useCardPacks";
import { useCursorSync } from "../hooks/useCursorSync";
import { useImagePreloader } from "../hooks/useImagePreloader";
import { useLocalGame } from "../hooks/useLocalGame";
import { useOnlineGame } from "../hooks/useOnlineGame";
import { useOpponentDisconnect } from "../hooks/useOpponentDisconnect";
import {
	calculateWinner,
	createInitialState,
	getPlayersFromPresence,
	initializeCards,
	shuffleCards,
	startGameWithCards,
} from "../services/game/GameEngine";
import { getFirestoreSyncAdapter } from "../services/sync/FirestoreSyncAdapter";
import { useOnlineStore } from "../stores/onlineStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { CardPack, GameMode, GameTheme } from "../types";

// SetupStep type is now derived from route paths
type SetupStep =
	| "modeSelect"
	| "theme"
	| "cardPack"
	| "background"
	| "cardBack"
	| "pairCount"
	| "startGame"
	| null;

const ENABLE_SETUP_DEBUG_LOGS = import.meta.env.DEV;

const setupWizardLog = (...args: unknown[]) => {
	if (!ENABLE_SETUP_DEBUG_LOGS) return;
	debugLog("[Setup Wizard]", ...args);
};

// Removed setupWizardWarn - no longer needed with router navigation

// Delay for autosize calculations to wait for layout to settle

// Secret keyboard combo: P+P+O+N+G (press P twice, then O, N, G)
const COMBO_SEQUENCE = ["p", "p", "o", "n", "g"];
// Test combo: 1, 2, 2, 5, 1, 2, 2, 5 (to advance game to end state)
const TEST_COMBO_SEQUENCE = ["1", "2", "2", "5", "1", "2", "2", "5"];

// Check if screen is mobile-sized (< 768px)
const isMobileScreen = () => {
	return window.innerWidth < 768;
};

// Check if device is an iPad
const isIPad = () => {
	const ua = navigator.userAgent.toLowerCase();
	// Check for iPad in user agent (older iPads)
	if (ua.includes("ipad")) {
		return true;
	}
	// Check for newer iPads that report as Mac but have touch support
	if (ua.includes("macintosh") && "ontouchend" in document) {
		return true;
	}
	return false;
};

// Check if app is running as a PWA (standalone mode)
const isRunningAsPWA = () => {
	// Check for standalone display mode (standard PWA detection)
	if (window.matchMedia("(display-mode: standalone)").matches) {
		return true;
	}
	// iOS Safari specific check
	if (
		"standalone" in window.navigator &&
		(window.navigator as Navigator & { standalone?: boolean }).standalone ===
			true
	) {
		return true;
	}
	return false;
};

// Check on mount if iPad and show PWA install modal
export function useAppModel() {
	const navigate = useNavigate();
	const routerState = useRouterState();
	const currentPath = routerState.location.pathname;

	const {
		selectedPack,
		setSelectedPack,
		getCurrentPackImages,
		getPackImagesForPairCount,
		cardPacks,
	} = useCardPacks();

	// Get pair count settings from settings store
	const localPairCount = useSettingsStore(
		(state) => state.settings.localPairCount,
	);
	const onlinePairCount = useSettingsStore(
		(state) => state.settings.onlinePairCount,
	);
	const setLocalPairCount = useSettingsStore(
		(state) => state.setLocalPairCount,
	);
	const setOnlinePairCount = useSettingsStore(
		(state) => state.setOnlinePairCount,
	);

	// Get blur settings from settings store
	const backgroundBlurEnabled = useSettingsStore(
		(state) => state.settings.backgroundBlurEnabled,
	);
	const setBackgroundBlurEnabled = useSettingsStore(
		(state) => state.setBackgroundBlurEnabled,
	);

	// Local game hook - uses useGameController internally for unified game logic
	const localGame = useLocalGame();
	const { selectedBackground, setSelectedBackground, getCurrentBackground } =
		useBackgroundSelector();
	const { selectedCardBack, setSelectedCardBack, getCurrentCardBack } =
		useCardBackSelector();
	const { isFullscreen, toggleFullscreen } = useFullscreen();

	// Derive setupStep from current route
	const setupStep: SetupStep = useMemo(() => {
		if (currentPath === "/") return "modeSelect";
		if (currentPath === "/local/theme") return "theme";
		if (currentPath === "/local/card-pack") return "cardPack";
		if (currentPath === "/local/background") return "background";
		if (currentPath === "/local/card-back") return "cardBack";
		if (currentPath === "/local/pair-count") return "pairCount";
		if (currentPath === "/local/start") return "startGame";
		if (currentPath === "/local/game") return null;
		if (currentPath === "/online") return "modeSelect";
		if (currentPath === "/online/game") return null;
		if (currentPath === "/game-over") return null;
		return null;
	}, [currentPath]);

	const [isResetting, setIsResetting] = useState(false);
	const [cameFromTheme, setCameFromTheme] = useState(false); // Track if we came from theme selection
	const [originalPack, setOriginalPack] = useState<string | null>(null);
	const [originalBackground, setOriginalBackground] =
		useState<BackgroundTheme | null>(null);
	const [originalCardBack, setOriginalCardBack] = useState<CardBackType | null>(
		null,
	);
	const [showResetConfirmation, setShowResetConfirmation] = useState(false);
	const [showReloadConfirmation, setShowReloadConfirmation] = useState(false);
	const [lastConfig, setLastConfig] = useState<{
		pack: CardPack;
		background: BackgroundTheme;
		cardBack: CardBackType;
		firstPlayer: number;
		pairCount: number;
	} | null>(null);
	const [isReplaying, setIsReplaying] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [selectedPlayerForMatches, setSelectedPlayerForMatches] = useState<
		number | null
	>(null);
	const [glowingPlayer, setGlowingPlayer] = useState<number | null>(null);
	const prevCurrentPlayerRef = useRef<number | null>(null);
	const [showPong, setShowPong] = useState(false);
	const comboSequenceRef = useRef<string[]>([]);
	const comboTimeoutRef = useRef<number | null>(null);
	const testComboSequenceRef = useRef<string[]>([]);
	const testComboTimeoutRef = useRef<number | null>(null);
	const [showCardExplorer, setShowCardExplorer] = useState(false);
	const [showBackgroundViewer, setShowBackgroundViewer] = useState(false);
	const [showAdminSidebar, setShowAdminSidebar] = useState(false);
	const [adminEnabled, setAdminEnabled] = useState(false); // In-memory only, resets on refresh
	const [showLogViewer, setShowLogViewer] = useState(false);
	const [showBuildInfo, setShowBuildInfo] = useState(false);
	const [showMobileWarning, setShowMobileWarning] = useState(false);
	const [gameMode, setGameMode] = useState<GameMode | null>(null);
	const [showPWAInstall, setShowPWAInstall] = useState(false);

	// Preload images when user reaches pair count or start game step
	// This gives time for assets to cache while user configures the game
	const preloadEnabled = setupStep === "pairCount" || setupStep === "startGame";
	useImagePreloader({
		background: selectedBackground,
		cardBack: selectedCardBack,
		cardPack: selectedPack,
		pairCount: gameMode === "online" ? onlinePairCount : localPairCount,
		enabled: preloadEnabled,
	});
	const refreshCheckDoneRef = useRef(false);
	const isRefreshRedirectingRef = useRef(false);
	const navigateRef = useRef(navigate);

	// Keep navigate ref updated (TanStack Router's navigate is stable, but this ensures we always have latest)
	navigateRef.current = navigate;

	// Clear navigation flag on page unload (before refresh)
	// This ensures refresh detection works correctly
	useEffect(() => {
		const handleBeforeUnload = () => {
			sessionStorage.removeItem("appNavigation");
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => {
			window.removeEventListener("beforeunload", handleBeforeUnload);
		};
	}, []);

	// Refresh detection: Redirect to home on page refresh
	// This ensures the app always starts fresh after a refresh, regardless of the URL
	// Using useLayoutEffect to run synchronously before other useEffect hooks (like route guards)
	// that might set the appNavigation flag
	useLayoutEffect(() => {
		// Only check once per page load
		if (refreshCheckDoneRef.current) {
			return;
		}
		refreshCheckDoneRef.current = true;

		// Check if this is a page refresh (not programmatic navigation)
		const isAppNavigation = sessionStorage.getItem("appNavigation");
		const path = window.location.pathname;

		// Standalone pages that can be bookmarked/shared - don't redirect these
		const standalonePages = ["/terms", "/privacy"];
		const isStandalonePage = standalonePages.includes(path);

		// Use window.location.pathname instead of routerState to avoid reactive updates
		// This reads the actual browser URL without triggering React re-renders
		if (path !== "/" && !isAppNavigation && !isStandalonePage) {
			debugLog(
				"[REFRESH] Page refreshed on route:",
				path,
				"- redirecting to home",
			);
			isRefreshRedirectingRef.current = true;
			// Use ref to avoid dependency on navigate function
			navigateRef.current({ to: "/" });
		}
	}, []); // Empty deps - only run once on mount, use ref for navigate

	// Online multiplayer state
	const {
		roomCode,
		room,
		odahId,
		leaveRoom,
		subscribeToPresence,
		isHost,
		updateRoomConfig,
		resetRoomToWaiting,
		setPlayerNamePreference,
		presenceData,
		updatePlayerName: updateOnlinePlayerName,
	} = useOnlineStore(
		useShallow((s) => ({
			roomCode: s.roomCode,
			room: s.room,
			odahId: s.odahId,
			leaveRoom: s.leaveRoom,
			subscribeToPresence: s.subscribeToPresence,
			isHost: s.isHost,
			updateRoomConfig: s.updateRoomConfig,
			resetRoomToWaiting: s.resetRoomToWaiting,
			setPlayerNamePreference: s.setPlayerNamePreference,
			presenceData: s.presenceData,
			updatePlayerName: s.updatePlayerName,
		})),
	);
	// Get local player slot from presence data
	const localPlayerSlot =
		odahId && presenceData[odahId] ? presenceData[odahId].slot : null;

	// Online game hook - only meaningful when in online mode with valid room
	// Game state is loaded from separate /games/{roomCode} document via Firestore subscription
	// Pass 0 when localPlayerSlot is not yet known from presence data - the hook will delay
	// subscription until a valid slot (1 or 2) is received, preventing race conditions
	const onlineGame = useOnlineGame({
		roomCode: roomCode || "",
		localPlayerSlot: localPlayerSlot || 0,
		flipDuration: localGame.flipDuration,
		initialGameState: localGame.gameState, // Initial empty state; confirmed game snapshots replace it
		players: getPlayersFromPresence(presenceData),
		effectManager: localGame.effectManager,
	});

	const getPackImagesById = useCallback((packId: CardPack) => {
		const deck = CARD_DECKS.find((d) => d.id === packId) || CARD_DECKS[0];
		return deck.cards.map((card) => ({
			id: card.id,
			url: card.imageUrl || card.emoji,
			gradient: card.gradient,
		}));
	}, []);

	const startOnlineRound = useCallback(
		async (options: {
			firstPlayer: 1 | 2;
			pack: CardPack;
			background: BackgroundTheme;
			cardBack: CardBackType;
			pairCount?: number;
		}) => {
			if (!roomCode || !room || !isHost) {
				console.warn("[Online] Only the host can start a new round");
				return;
			}

			useOnlineStore.getState().setError(null);
			try {
				const adapter = getFirestoreSyncAdapter();
				const players = Object.values(presenceData);
				const hostPlayer = players.find((p) => p.slot === 1);
				const guestPlayer = players.find((p) => p.slot === 2);

				if (!hostPlayer || !guestPlayer) {
					throw new Error(
						"Both players must be present before starting a new round",
					);
				}

				// Get images for the pack, filtered by pair count if specified
				const allPackImages = getPackImagesById(options.pack);
				const pairCount = options.pairCount || 20;
				const imagesToUse =
					pairCount < allPackImages.length
						? shuffleCards(allPackImages).slice(0, pairCount)
						: allPackImages;

				const cards = initializeCards(imagesToUse);
				// Player info is stored in presence data, not game state
				const initialState = createInitialState(options.firstPlayer);
				const nextState = startGameWithCards(initialState, cards);

				await adapter.startGame(roomCode, nextState);
				const confirmed = await adapter.getState();
				if (!confirmed) throw new Error("Started game was not found");
				onlineGame.setFullGameState(confirmed);

				const configUpdates: {
					cardPack?: CardPack;
					background?: string;
					cardBack?: string;
					pairCount?: number;
				} = {};
				if (room.config?.cardPack !== options.pack)
					configUpdates.cardPack = options.pack;
				if (room.config?.background !== options.background)
					configUpdates.background = options.background;
				if (room.config?.cardBack !== options.cardBack)
					configUpdates.cardBack = options.cardBack;
				if (room.config?.pairCount !== pairCount)
					configUpdates.pairCount = pairCount;
				if (Object.keys(configUpdates).length > 0) {
					await updateRoomConfig(configUpdates);
				}
			} catch (error) {
				useOnlineStore
					.getState()
					.setError(
						error instanceof Error ? error.message : "Failed to start round",
					);
				throw error;
			}
		},
		[
			roomCode,
			room,
			isHost,
			getPackImagesById,
			updateRoomConfig,
			presenceData,
			onlineGame,
		],
	);

	// Select which game interface to use based on mode
	// In online mode: use onlineGame for state/actions, localGame for settings
	const isOnlineMode =
		gameMode === "online" && roomCode && localPlayerSlot !== null;

	// Disconnect detection for online mode
	const disconnectState = useOpponentDisconnect({ timeoutSeconds: 60 });

	const gameState = isOnlineMode ? onlineGame.gameState : localGame.gameState;

	// Derive players from presence data (online) or settings (local)
	const players = useMemo(() => {
		if (isOnlineMode) {
			return getPlayersFromPresence(presenceData);
		}
		return localGame.players;
	}, [isOnlineMode, presenceData, localGame.players]);

	// Derive winner/isTie from game state when game is finished
	const { winner, isTie } = useMemo(() => {
		if (gameState.gameStatus === "finished") {
			return calculateWinner(gameState.cards, players);
		}
		return { winner: null, isTie: false };
	}, [gameState.gameStatus, gameState.cards, players]);

	// Navigate to game-over route when game finishes
	useEffect(() => {
		if (gameState.gameStatus === "finished" && currentPath !== "/game-over") {
			sessionStorage.setItem("appNavigation", "true");
			const timer = setTimeout(() => navigate({ to: "/game-over" }), 1200);
			return () => clearTimeout(timer);
		}
	}, [gameState.gameStatus, currentPath, navigate]);

	// Navigate to game route when game starts playing (handles guest receiving replay from host)
	useEffect(() => {
		if (
			isOnlineMode &&
			gameState.gameStatus === "playing" &&
			gameState.cards.length > 0 &&
			currentPath === "/game-over"
		) {
			debugLog(
				"[GAME STATUS] Game is playing while on game-over route - navigating to game",
			);
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online/game" });
		}
	}, [
		isOnlineMode,
		gameState.gameStatus,
		gameState.cards.length,
		currentPath,
		navigate,
	]);

	// Set game mode based on current route
	useEffect(() => {
		if (currentPath.startsWith("/local")) {
			setGameMode("local");
		} else if (currentPath.startsWith("/online")) {
			setGameMode("online");
		} else if (currentPath === "/") {
			// Don't reset gameMode on home - let user choose
		}
	}, [currentPath]);

	// Route guards: Redirect if trying to access game routes without setup
	// Skip if a refresh redirect is already in progress
	useEffect(() => {
		if (isRefreshRedirectingRef.current) {
			return;
		}

		if (
			currentPath === "/local/game" &&
			gameState.cards.length === 0 &&
			gameState.gameStatus !== "playing"
		) {
			// No cards and not playing - redirect to theme selection
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/local/theme" });
		}
		if (currentPath === "/online/game" && !roomCode) {
			// No room code - redirect to online lobby
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online" });
		}

		// Online route guards
		if (currentPath === "/online/waiting" && !roomCode) {
			// On waiting room but no room code - redirect to choice
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online" });
		}
		if (
			(currentPath === "/online/create" || currentPath === "/online/join") &&
			roomCode
		) {
			// Room already created/joined - redirect to waiting room
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online/waiting" });
		}
	}, [
		currentPath,
		gameState.cards.length,
		gameState.gameStatus,
		roomCode,
		navigate,
	]);

	// Navigate to waiting room when room status changes to 'waiting' during online game
	// This handles the case where host clicks "New Game" - guest is taken back to waiting room
	useEffect(() => {
		if (currentPath === "/online/game" && room?.status === "waiting") {
			debugLog(
				"[ROOM STATUS] Room status is waiting while on game route - navigating to waiting room",
			);
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online/waiting" });
		}
	}, [currentPath, room?.status, navigate]);

	// Get opponent's odahId for cursor sync
	const opponentOdahId = useMemo(() => {
		if (!odahId) return null;
		const opponentEntry = Object.entries(presenceData).find(
			([id]) => id !== odahId,
		);
		return opponentEntry ? opponentEntry[0] : null;
	}, [presenceData, odahId]);

	// Get opponent's player info for cursor display
	const opponentInfo = useMemo(() => {
		if (!opponentOdahId) return null;
		const opponentPresence = presenceData[opponentOdahId];
		if (!opponentPresence) return null;
		return {
			name: opponentPresence.name,
			color: opponentPresence.color,
		};
	}, [presenceData, opponentOdahId]);

	// Subscribe to presence during online gameplay
	// OnlineLobby handles presence in the waiting room, but unmounts when game starts
	// This subscription takes over to track presence during the actual game
	useEffect(() => {
		// Only subscribe when we're actively playing an online game
		// During waiting room phase, OnlineLobby handles the subscription
		const shouldSubscribe =
			isOnlineMode && roomCode && gameState.gameStatus === "playing";

		if (!shouldSubscribe) return;

		debugLog("[App] Subscribing to presence for gameplay, room:", roomCode);
		const unsubPresence = subscribeToPresence(roomCode);

		return () => {
			debugLog("[App] Unsubscribing from gameplay presence");
			unsubPresence();
		};
	}, [isOnlineMode, roomCode, gameState.gameStatus, subscribeToPresence]);
	const setFullGameState = isOnlineMode
		? onlineGame.setFullGameState
		: localGame.setFullGameState;
	const flipCard = isOnlineMode ? onlineGame.flipCard : localGame.flipCard;
	const endTurn = isOnlineMode ? onlineGame.endTurn : localGame.endTurn;
	const toggleAllCardsAdmin = isOnlineMode
		? onlineGame.toggleAllCardsFlipped
		: localGame.toggleAllCardsFlipped;
	const endGameEarly = isOnlineMode
		? onlineGame.endGameEarly
		: localGame.endGameEarly;

	// Settings and game functions come from useLocalGame (unified hook)
	const {
		// Settings
		cardSize,
		autoSizeEnabled,
		useWhiteCardBackground,
		flipDuration,
		emojiSizePercentage,
		ttsEnabled,
		// Settings actions
		increaseCardSize,
		decreaseCardSize,
		toggleWhiteCardBackground,
		toggleAutoSize,
		increaseFlipDuration,
		decreaseFlipDuration,
		increaseEmojiSize,
		decreaseEmojiSize,
		toggleTtsEnabled,
		updatePlayerName,
		updatePlayerColor,
		// Layout
		updateAutoSizeMetrics,
		calculateOptimalCardSizeForCount,
		// Game actions
		initializeGame,
		startGameWithFirstPlayer,
		resetGame,
		isAnimatingCards,
	} = localGame;

	// Cursor sync for online mode - only active during gameplay
	const cursorSyncEnabled = Boolean(
		isOnlineMode && gameState.gameStatus === "playing",
	);
	const {
		opponentCursor,
		handleMouseMove: handleCursorMove,
		handleMouseLeave: handleCursorLeave,
	} = useCursorSync({
		roomCode: roomCode || "",
		localOdahId: odahId || "",
		opponentOdahId,
		enabled: cursorSyncEnabled,
		cardSize,
	});

	// Build remote cursor data for GameBoard
	const remoteCursorData = useMemo(() => {
		if (!opponentCursor || !opponentInfo) return null;
		return {
			position: opponentCursor,
			playerName: opponentInfo.name,
			playerColor: opponentInfo.color,
		};
	}, [opponentCursor, opponentInfo]);

	const getActiveConfig = useCallback(() => {
		if (isOnlineMode) {
			return {
				pack: (room?.config?.cardPack as CardPack) || selectedPack,
				background:
					(room?.config?.background as BackgroundTheme) || selectedBackground,
				cardBack: (room?.config?.cardBack as CardBackType) || selectedCardBack,
			};
		}

		return {
			pack: selectedPack,
			background: selectedBackground,
			cardBack: selectedCardBack,
		};
	}, [isOnlineMode, room, selectedPack, selectedBackground, selectedCardBack]);

	const handlePlayerNameChange = useCallback(
		async (playerId: 1 | 2, name: string) => {
			if (isOnlineMode) {
				// In online mode, player names are managed via presence data (RTDB)
				// Only allow updating own name (verified by slot)
				if (localPlayerSlot === playerId) {
					// Update RTDB presence (syncs to other player)
					await updateOnlinePlayerName(name);
					// Also persist preference for future sessions
					setPlayerNamePreference(name);
				}
			} else {
				updatePlayerName(playerId, name);
			}
		},
		[
			isOnlineMode,
			localPlayerSlot,
			updateOnlinePlayerName,
			setPlayerNamePreference,
			updatePlayerName,
		],
	);

	const handleOpenPlayerMatches = useCallback(
		(playerId: number) => setSelectedPlayerForMatches(playerId),
		[],
	);

	const boardWrapperRef = useRef<HTMLDivElement>(null);
	const scoreboardRef = useRef<HTMLDivElement>(null);
	const gameBoardContainerRef = useRef<HTMLDivElement>(null);

	// Long-press detection for background viewer during gameplay
	const longPressTimerRef = useRef<number | null>(null);
	const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);
	const LONG_PRESS_DURATION = 1000;
	const LONG_PRESS_MOVE_THRESHOLD = 10; // pixels - cancel if moved more than this

	const handleBackgroundLongPressStart = useCallback(
		(clientX: number, clientY: number) => {
			// Only enable during gameplay
			if (gameState.gameStatus !== "playing") return;

			// Clear any existing timer
			if (longPressTimerRef.current) {
				clearTimeout(longPressTimerRef.current);
			}

			// Store starting position to detect movement
			longPressStartPosRef.current = { x: clientX, y: clientY };

			// Start the long press timer
			longPressTimerRef.current = window.setTimeout(() => {
				setShowBackgroundViewer(true);
				longPressTimerRef.current = null;
				longPressStartPosRef.current = null;
			}, LONG_PRESS_DURATION);
		},
		[gameState.gameStatus],
	);

	const handleBackgroundLongPressEnd = useCallback(() => {
		// Cancel the long press timer
		if (longPressTimerRef.current) {
			clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = null;
		}
		longPressStartPosRef.current = null;
	}, []);

	const handleBackgroundLongPressMove = useCallback(
		(clientX: number, clientY: number) => {
			// If no long press in progress, ignore
			if (!longPressStartPosRef.current || !longPressTimerRef.current) return;

			// Calculate movement distance
			const dx = clientX - longPressStartPosRef.current.x;
			const dy = clientY - longPressStartPosRef.current.y;
			const distance = Math.sqrt(dx * dx + dy * dy);

			// Cancel if moved too much
			if (distance > LONG_PRESS_MOVE_THRESHOLD) {
				clearTimeout(longPressTimerRef.current);
				longPressTimerRef.current = null;
				longPressStartPosRef.current = null;
			}
		},
		[],
	);

	// Clean up long press timer on unmount
	useEffect(() => {
		return () => {
			if (longPressTimerRef.current) {
				clearTimeout(longPressTimerRef.current);
			}
		};
	}, []);

	// Document-level event listeners for long-press background viewer
	// Only active during gameplay, ignores clicks on interactive elements
	useEffect(() => {
		if (gameState.gameStatus !== "playing") return;

		const isInteractiveElement = (target: EventTarget | null): boolean => {
			if (!target || !(target instanceof HTMLElement)) return false;
			// Check if target or any ancestor is an interactive element
			const interactiveSelectors =
				'button, a, input, textarea, [role="button"], [data-card], .card-container';
			return target.closest(interactiveSelectors) !== null;
		};

		const handleDocumentMouseDown = (e: MouseEvent) => {
			if (e.button !== 0) return; // Only left click
			if (isInteractiveElement(e.target)) return; // Ignore interactive elements
			handleBackgroundLongPressStart(e.clientX, e.clientY);
		};

		const handleDocumentMouseUp = () => {
			handleBackgroundLongPressEnd();
		};

		const handleDocumentMouseMove = (e: MouseEvent) => {
			handleBackgroundLongPressMove(e.clientX, e.clientY);
		};

		const handleDocumentTouchStart = (e: TouchEvent) => {
			if (e.touches.length !== 1) return;
			if (isInteractiveElement(e.target)) return; // Ignore interactive elements
			handleBackgroundLongPressStart(
				e.touches[0].clientX,
				e.touches[0].clientY,
			);
		};

		const handleDocumentTouchEnd = () => {
			handleBackgroundLongPressEnd();
		};

		const handleDocumentTouchMove = (e: TouchEvent) => {
			if (e.touches.length === 1) {
				handleBackgroundLongPressMove(
					e.touches[0].clientX,
					e.touches[0].clientY,
				);
			}
		};

		document.addEventListener("mousedown", handleDocumentMouseDown);
		document.addEventListener("mouseup", handleDocumentMouseUp);
		document.addEventListener("mousemove", handleDocumentMouseMove);
		document.addEventListener("touchstart", handleDocumentTouchStart);
		document.addEventListener("touchend", handleDocumentTouchEnd);
		document.addEventListener("touchmove", handleDocumentTouchMove);

		return () => {
			document.removeEventListener("mousedown", handleDocumentMouseDown);
			document.removeEventListener("mouseup", handleDocumentMouseUp);
			document.removeEventListener("mousemove", handleDocumentMouseMove);
			document.removeEventListener("touchstart", handleDocumentTouchStart);
			document.removeEventListener("touchend", handleDocumentTouchEnd);
			document.removeEventListener("touchmove", handleDocumentTouchMove);
		};
	}, [
		gameState.gameStatus,
		handleBackgroundLongPressStart,
		handleBackgroundLongPressEnd,
		handleBackgroundLongPressMove,
	]);

	// Helper function to navigate to setup steps
	const navigateToStep = useCallback(
		(step: SetupStep, reason: string) => {
			setupWizardLog("Navigating to step", { to: step, reason });

			// Set navigation flag to indicate this is programmatic navigation, not a refresh
			sessionStorage.setItem("appNavigation", "true");

			if (step === null) {
				// Handle closing wizard - navigate based on game state
				if (gameState.gameStatus === "playing") {
					// If closing wizard and game is playing, navigate to game route
					navigate({
						to: gameMode === "online" ? "/online/game" : "/local/game",
					});
				} else if (gameState.gameStatus === "finished") {
					// If closing wizard and game is finished, navigate to game over
					navigate({ to: "/game-over" });
				} else {
					// Default: go to home
					navigate({ to: "/" });
					// Clear flag when navigating to home
					sessionStorage.removeItem("appNavigation");
				}
				return;
			}

			const routeMap: Record<Exclude<SetupStep, null>, string> = {
				modeSelect: "/",
				theme: "/local/theme",
				cardPack: "/local/card-pack",
				background: "/local/background",
				cardBack: "/local/card-back",
				pairCount: "/local/pair-count",
				startGame: "/local/start",
			};

			const targetRoute = routeMap[step];
			if (targetRoute) {
				if (targetRoute === "/") {
					// Clear flag when navigating to home
					sessionStorage.removeItem("appNavigation");
				}
				navigate({
					to: targetRoute as
						| "/"
						| "/local/theme"
						| "/local/card-pack"
						| "/local/background"
						| "/local/card-back"
						| "/local/pair-count"
						| "/local/start",
				});
			}
		},
		[navigate, gameState.gameStatus, gameMode],
	);

	// Clear game state on page refresh - restart from scratch
	// But keep player preferences (names, colors, firstPlayer) and deck options
	useEffect(() => {
		// Clear sessionStorage game state
		sessionStorage.removeItem("gameState");
		sessionStorage.removeItem("setupStep");
		sessionStorage.removeItem("mobileWarningDismissed");

		// Note: We keep localStorage items for player names, colors, firstPlayer
		// and card pack/background/cardBack preferences - only game state is cleared

		debugLog(
			"[REFRESH] Cleared game state from storage (kept player preferences)",
		);
	}, []); // Run once on mount

	useEffect(() => {
		// Don't show modal if already running as PWA
		if (isRunningAsPWA()) {
			return;
		}

		if (isIPad()) {
			const pwaInstallDismissed = localStorage.getItem("pwaInstallDismissed");
			if (!pwaInstallDismissed) {
				// Small delay to ensure page is loaded
				setTimeout(() => {
					setShowPWAInstall(true);
				}, 500);
			}
		}
	}, []);

	const handlePWAInstallClose = () => {
		setShowPWAInstall(false);
		localStorage.setItem("pwaInstallDismissed", "true");
	};

	const handleShowPWAInstall = () => {
		setShowPWAInstall(true);
	};

	// Show mobile warning when game starts if on mobile
	useEffect(() => {
		if (gameState.gameStatus === "playing" && gameState.cards.length > 0) {
			// Check if user has already dismissed the warning this session
			const warningDismissed = sessionStorage.getItem("mobileWarningDismissed");
			if (!warningDismissed && isMobileScreen()) {
				setShowMobileWarning(true);
			}
		}
	}, [gameState.gameStatus, gameState.cards.length]);

	// Also check when auto-size is enabled
	useEffect(() => {
		if (autoSizeEnabled && isMobileScreen()) {
			const warningDismissed = sessionStorage.getItem("mobileWarningDismissed");
			if (!warningDismissed) {
				setShowMobileWarning(true);
			}
		}
	}, [autoSizeEnabled]);

	// Check on window resize if auto-size is enabled
	useEffect(() => {
		if (!autoSizeEnabled) return;

		const handleResize = () => {
			const warningDismissed = sessionStorage.getItem("mobileWarningDismissed");
			if (!warningDismissed && isMobileScreen() && gameState.cards.length > 0) {
				setShowMobileWarning(true);
			}
		};

		window.addEventListener("resize", handleResize);
		return () => window.removeEventListener("resize", handleResize);
	}, [autoSizeEnabled, gameState.cards.length]);

	const handleMobileWarningClose = () => {
		setShowMobileWarning(false);
		// Remember that user dismissed it for this session
		sessionStorage.setItem("mobileWarningDismissed", "true");
	};

	// Calculate card size immediately when pack is selected or auto-size is enabled
	// This happens before cards are created, ensuring correct size from the start
	useEffect(() => {
		if (!autoSizeEnabled || gameState.cards.length > 0) {
			// Don't calculate if auto-size is disabled or game is already in progress
			return;
		}

		// Get card count from selected pack
		const images = getCurrentPackImages();
		const cardCount = images.length * 2; // Each image becomes a pair

		if (cardCount > 0) {
			calculateOptimalCardSizeForCount(cardCount);
		}
	}, [
		autoSizeEnabled,
		getCurrentPackImages,
		calculateOptimalCardSizeForCount,
		gameState.cards.length,
	]);

	useBoardLayout({
		autoSizeEnabled,
		gameState,
		currentPath,
		boardWrapperRef,
		scoreboardRef,
		gameBoardContainerRef,
		updateAutoSizeMetrics,
		calculateOptimalCardSizeForCount,
	});

	// Detect turn switches and trigger glow effect
	useEffect(() => {
		if (
			gameState.gameStatus === "playing" &&
			gameState.currentPlayer !== prevCurrentPlayerRef.current
		) {
			// Only trigger glow if there was a previous player (not on initial game start)
			if (prevCurrentPlayerRef.current !== null) {
				debugLog(
					"[GLOW] Triggering glow for player",
					gameState.currentPlayer,
					"from",
					prevCurrentPlayerRef.current,
				);
				setGlowingPlayer(gameState.currentPlayer);
				// Clear glow after animation completes (1 second)
				const timer = setTimeout(() => {
					setGlowingPlayer(null);
				}, 1000);
				// Update ref after setting glow
				prevCurrentPlayerRef.current = gameState.currentPlayer;
				return () => clearTimeout(timer);
			}
			// Update ref even when not showing glow (initial game start)
			prevCurrentPlayerRef.current = gameState.currentPlayer;
		}

		// Reset glow when game status changes
		if (gameState.gameStatus !== "playing") {
			setGlowingPlayer(null);
			prevCurrentPlayerRef.current = null;
		}
	}, [gameState.currentPlayer, gameState.gameStatus]);

	// Handle replay initialization when pack changes
	useEffect(() => {
		if (isReplaying && lastConfig && selectedPack === lastConfig.pack) {
			// Use the stored pair count to get the same number of cards
			const images = getPackImagesForPairCount(lastConfig.pairCount);
			initializeGame(images, true);
			startGameWithFirstPlayer(lastConfig.firstPlayer);
			setIsReplaying(false);
			// Navigate to game route for local mode replay
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/local/game" });
		}
	}, [
		selectedPack,
		isReplaying,
		lastConfig,
		getPackImagesForPairCount,
		initializeGame,
		startGameWithFirstPlayer,
		navigate,
	]);

	// Welcome screen shows when no cards exist and setupStep is null
	// User must click "Start Game" to begin setup flow

	const handleThemeSelect = (theme: GameTheme) => {
		// Apply theme settings
		setSelectedPack(theme.cardPack as CardPack);
		setSelectedBackground(theme.background as BackgroundTheme);
		setSelectedCardBack(theme.cardBack as CardBackType);
		setCameFromTheme(true); // Mark that we came from theme selection
		// Go to pair count selection before start game
		navigateToStep("pairCount", "theme selected");
	};

	const handleBuildCustom = () => {
		setCameFromTheme(false); // Mark that we're building custom
		// Continue to card pack selection
		navigateToStep("cardPack", "build custom selected");
	};

	const handlePackChange = (newPack: string) => {
		setSelectedPack(newPack as CardPack);
		navigateToStep("background", "pack selected");
	};

	const handleBackgroundChange = (newBackground: BackgroundTheme) => {
		setSelectedBackground(newBackground);
		navigateToStep("cardBack", "background selected");
	};

	const handleCardBackChange = (newCardBack: CardBackType) => {
		setSelectedCardBack(newCardBack);
		setCameFromTheme(false); // Mark that we came from custom build flow
		navigateToStep("pairCount", "card back selected");
	};

	const handlePairCountChange = (count: number) => {
		// Store pair count based on game mode
		if (gameMode === "online") {
			setOnlinePairCount(count);
		} else {
			setLocalPairCount(count);
		}
		navigateToStep("startGame", "pair count selected");
	};

	const handlePairCountModalBack = () => {
		if (cameFromTheme) {
			navigateToStep("theme", "back button from pair count modal (from theme)");
		} else {
			navigateToStep(
				"cardBack",
				"back button from pair count modal (from custom)",
			);
		}
	};

	const handleResetClick = () => {
		const activeConfig = getActiveConfig();

		// Get pair count from current game's card count
		const currentPairCount = Math.floor(gameState.cards.length / 2);

		// Store current configuration as last config
		setLastConfig({
			...activeConfig,
			firstPlayer: gameState.currentPlayer,
			pairCount: currentPairCount,
		});
		setShowResetConfirmation(true);
	};

	const handleReplay = useCallback(async () => {
		if (isOnlineMode) {
			setShowResetConfirmation(false);
			if (!isHost) {
				console.warn("[Online] Only the host can restart the game");
				return;
			}

			const activeConfig = getActiveConfig();
			// Get pair count from lastConfig, room config, or fallback to current game's card count
			const currentPairCount =
				lastConfig?.pairCount ||
				room?.config?.pairCount ||
				Math.floor(gameState.cards.length / 2) ||
				20;
			const configSource = lastConfig || {
				...activeConfig,
				firstPlayer: (onlineGame.gameState?.currentPlayer as 1 | 2) || 1,
				pairCount: currentPairCount,
			};

			const normalizedConfig = {
				pack: configSource.pack as CardPack,
				background: configSource.background,
				cardBack: configSource.cardBack,
				firstPlayer: (configSource.firstPlayer === 2 ? 2 : 1) as 1 | 2,
				pairCount: configSource.pairCount,
			};

			try {
				await startOnlineRound(normalizedConfig);
			} catch {
				return;
			}
			setLastConfig({
				pack: normalizedConfig.pack,
				background: normalizedConfig.background,
				cardBack: normalizedConfig.cardBack,
				firstPlayer: normalizedConfig.firstPlayer,
				pairCount: normalizedConfig.pairCount,
			});
			// Navigate to game route for online mode replay
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online/game" });
			return;
		}

		if (!lastConfig) return;

		resetGame();
		setSelectedPack(lastConfig.pack);
		setSelectedBackground(lastConfig.background);
		setSelectedCardBack(lastConfig.cardBack);
		setShowResetConfirmation(false);
		setIsReplaying(true);
	}, [
		isOnlineMode,
		isHost,
		lastConfig,
		room,
		startOnlineRound,
		resetGame,
		getActiveConfig,
		setSelectedPack,
		setSelectedBackground,
		setSelectedCardBack,
		gameState.cards.length,
		onlineGame.gameState?.currentPlayer,
		navigate,
	]);

	const handleNewGame = async () => {
		// Close reset confirmation modal
		setShowResetConfirmation(false);

		// Reset game state - explicitly set to setup state
		resetGame();
		setFullGameState({
			cards: [],
			currentPlayer: gameState.currentPlayer, // Keep current player preference
			gameStatus: "setup",
		});

		// Handle online mode differently - navigate to waiting room where host can change settings
		if (isOnlineMode) {
			// Reset room status to 'waiting' so the waiting room shows configuration UI
			// instead of auto-transitioning back to game
			if (isHost) {
				try {
					await resetRoomToWaiting();
				} catch (error) {
					console.error("Failed to reset room status:", error);
				}
			}
			sessionStorage.setItem("appNavigation", "true");
			navigate({ to: "/online/waiting" });
			return;
		}

		// Local mode: Start new game setup flow using the current game configuration as the baseline
		const activeConfig = getActiveConfig();

		setOriginalPack(activeConfig.pack);
		setOriginalBackground(activeConfig.background);
		setOriginalCardBack(activeConfig.cardBack);

		if (selectedPack !== activeConfig.pack) {
			setSelectedPack(activeConfig.pack);
		}
		if (selectedBackground !== activeConfig.background) {
			setSelectedBackground(activeConfig.background);
		}
		if (selectedCardBack !== activeConfig.cardBack) {
			setSelectedCardBack(activeConfig.cardBack);
		}

		setIsResetting(true);
		setCameFromTheme(false); // Reset theme tracking
		navigateToStep("theme", "new game clicked");
	};

	const handleBackToModeSelect = useCallback(async () => {
		// Full reset - go back to "How would you like to play?"
		setShowResetConfirmation(false);

		// If in online mode, leave the room
		if (gameMode === "online") {
			try {
				await leaveRoom();
			} catch (error) {
				console.error("Error leaving room:", error);
			}
		}

		// Reset all game state
		resetGame();
		setGameMode(null);
		setIsResetting(false);
		navigateToStep("modeSelect", "back to mode select");
	}, [gameMode, leaveRoom, resetGame, navigateToStep]);

	const cancelSetupFlow = () => {
		// Restore original state if resetting
		if (isResetting) {
			if (originalPack !== null) {
				setSelectedPack(originalPack as CardPack);
			}
			if (originalBackground !== null) {
				setSelectedBackground(originalBackground);
			}
			if (originalCardBack !== null) {
				setSelectedCardBack(originalCardBack);
			}
			setIsResetting(false);
		}
		setCameFromTheme(false); // Reset theme tracking
		navigateToStep(null, "cancel setup flow");
	};

	// Handler for leaving an online game (e.g., when opponent disconnects)
	const handleLeaveOnlineGame = useCallback(async () => {
		try {
			await leaveRoom();
		} catch (error) {
			console.error("Error leaving room:", error);
		}

		// Reset local game state
		resetGame();
		setGameMode(null);
		navigateToStep("modeSelect", "left online game after disconnect");
	}, [leaveRoom, resetGame, navigateToStep]);

	const handleStartModalBack = () => {
		// Go back to pair count selection (always, since it's the step before startGame)
		navigateToStep("pairCount", "back button from start modal");
	};

	const handleCardBackModalBack = () => {
		// Go back to background selection (intentional backward navigation)
		navigateToStep("background", "back button from card back modal");
	};

	const handleBackgroundModalBack = () => {
		// Go back to card pack selection (intentional backward navigation)
		navigateToStep("cardPack", "back button from background modal");
	};

	const handleStartGame = async (firstPlayer: number) => {
		const normalizedFirstPlayer = (firstPlayer === 2 ? 2 : 1) as 1 | 2;

		// Get the appropriate pair count based on game mode
		const activePairCount =
			gameMode === "online" ? onlinePairCount : localPairCount;

		if (isOnlineMode) {
			if (!isHost) {
				console.warn("[Online] Only the host can start the game");
				return;
			}

			try {
				await startOnlineRound({
					firstPlayer: normalizedFirstPlayer,
					pack: selectedPack,
					background: selectedBackground,
					cardBack: selectedCardBack,
					pairCount: activePairCount,
				});
			} catch {
				return;
			}

			navigateToStep(null, "game started");
			setIsResetting(false);
			setLastConfig({
				pack: selectedPack,
				background: selectedBackground,
				cardBack: selectedCardBack,
				firstPlayer: normalizedFirstPlayer,
				pairCount: activePairCount,
			});
			return;
		}

		// Get a random subset of images based on selected pair count
		const images = getPackImagesForPairCount(activePairCount);
		initializeGame(images, true); // true = start playing with animation
		startGameWithFirstPlayer(firstPlayer);
		// Explicitly navigate to game route for local mode
		sessionStorage.setItem("appNavigation", "true");
		navigate({ to: "/local/game" });
		setIsResetting(false);

		// Note: Autosize is handled by the "cards appear" effect which triggers
		// when gameState.cards.length changes, using AUTOSIZE_DEBOUNCE_MS delay

		setLastConfig({
			pack: selectedPack,
			background: selectedBackground,
			cardBack: selectedCardBack,
			firstPlayer,
			pairCount: activePairCount,
		});
	};

	// Set overflow hidden to prevent page scrolling
	// Settings sidebar will still scroll due to overflow-y-auto on its inner content
	// Skip for standalone pages (terms, privacy) that need to scroll
	const isStandalonePage =
		currentPath === "/terms" || currentPath === "/privacy";
	useEffect(() => {
		if (isStandalonePage) {
			// Allow scrolling on standalone pages - must explicitly set 'auto'
			// Setting to empty string doesn't work consistently across browsers
			document.body.style.overflow = "auto";
			document.documentElement.style.overflow = "auto";
			return;
		}

		document.body.style.overflow = "hidden";
		document.documentElement.style.overflow = "hidden";

		return () => {
			// Cleanup on unmount
			document.body.style.overflow = "";
			document.documentElement.style.overflow = "";
		};
	}, [isStandalonePage]);

	// Disable context menu globally
	useEffect(() => {
		const handleContextMenu = (e: MouseEvent) => {
			e.preventDefault();
		};

		window.addEventListener("contextmenu", handleContextMenu);

		return () => {
			window.removeEventListener("contextmenu", handleContextMenu);
		};
	}, []);

	// Keyboard combo detection for Pong
	useEffect(() => {
		const handleKeyPress = (e: KeyboardEvent) => {
			// Don't trigger if typing in an input field
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement
			) {
				return;
			}

			const key = e.key.toLowerCase();

			// Handle Pong combo
			// Clear timeout if exists
			if (comboTimeoutRef.current) {
				clearTimeout(comboTimeoutRef.current);
			}

			// Add key to sequence
			comboSequenceRef.current.push(key);

			// Keep only last 5 keys
			if (comboSequenceRef.current.length > COMBO_SEQUENCE.length) {
				comboSequenceRef.current.shift();
			}

			// Check if sequence matches
			if (comboSequenceRef.current.length === COMBO_SEQUENCE.length) {
				const matches = comboSequenceRef.current.every(
					(k, i) => k === COMBO_SEQUENCE[i],
				);

				if (matches) {
					setShowPong(true);
					comboSequenceRef.current = [];
				}
			}

			// Reset sequence after 2 seconds of no keypress
			comboTimeoutRef.current = window.setTimeout(() => {
				comboSequenceRef.current = [];
			}, 2000);

			// Handle test combo (1, 2, 2, 5, 1, 2, 2, 5)
			// Clear timeout if exists
			if (testComboTimeoutRef.current) {
				clearTimeout(testComboTimeoutRef.current);
			}

			// Add key to test sequence (use exact key, not lowercase)
			const testKey = e.key;
			testComboSequenceRef.current.push(testKey);

			// Keep only last 8 keys
			if (testComboSequenceRef.current.length > TEST_COMBO_SEQUENCE.length) {
				testComboSequenceRef.current.shift();
			}

			// Check if test sequence matches
			if (testComboSequenceRef.current.length === TEST_COMBO_SEQUENCE.length) {
				const matches = testComboSequenceRef.current.every(
					(k, i) => k === TEST_COMBO_SEQUENCE[i],
				);

				if (matches) {
					if (import.meta.env.MODE === "production") return;
					setAdminEnabled(true);
					setShowAdminSidebar(true);
					testComboSequenceRef.current = [];
				}
			}

			// Reset test sequence after 5 seconds of no keypress
			testComboTimeoutRef.current = window.setTimeout(() => {
				testComboSequenceRef.current = [];
			}, 5000);
		};

		window.addEventListener("keydown", handleKeyPress);

		return () => {
			window.removeEventListener("keydown", handleKeyPress);
			if (comboTimeoutRef.current) {
				clearTimeout(comboTimeoutRef.current);
			}
			if (testComboTimeoutRef.current) {
				clearTimeout(testComboTimeoutRef.current);
			}
		};
	}, []);

	// Note: Turn enforcement and sync are now handled inside useOnlineGame hook
	// The hook manages authority checking and Firestore sync internally

	// Get background - use room config for online mode, local settings for local mode
	const currentBackground = (() => {
		if (isOnlineMode && room?.config?.background) {
			// Find background option by room config
			const roomBg = BACKGROUND_OPTIONS.find(
				(bg) => bg.id === room.config?.background,
			);
			if (roomBg) return roomBg;
		}
		return getCurrentBackground();
	})();

	// Get card back - use room config for online mode, local settings for local mode
	const effectiveCardBack = (() => {
		if (isOnlineMode && room?.config?.cardBack) {
			// Find card back option by room config
			const roomCb = CARD_BACK_OPTIONS.find(
				(cb) => cb.id === room.config?.cardBack,
			);
			if (roomCb) return roomCb;
		}
		return getCurrentCardBack();
	})();

	// Only show custom background when playing the game (when cards exist)
	const shouldShowCustomBackground = gameState.cards.length > 0;
	const isPlaying = gameState.gameStatus === "playing";

	// Calculate effective blur: use per-background override if defined, otherwise default to 2px
	const effectiveBlurAmount = currentBackground.blurAmount ?? 2;
	const shouldBlur =
		isPlaying && backgroundBlurEnabled && effectiveBlurAmount > 0;
	const blurFilter = shouldBlur ? `blur(${effectiveBlurAmount}px)` : "none";

	// Background styles for the separate background layer
	const backgroundLayerStyle: React.CSSProperties =
		shouldShowCustomBackground && currentBackground.imageUrl
			? {
					backgroundImage: `url(${currentBackground.imageUrl})`,
					backgroundSize: "cover",
					backgroundPosition: "center",
					backgroundRepeat: "no-repeat",
					filter: blurFilter,
					transition: "filter 0.3s ease",
				}
			: {
					filter: blurFilter,
					transition: "filter 0.3s ease",
				};

	// Background class for gradient backgrounds (applied to background layer)
	const backgroundLayerClass =
		shouldShowCustomBackground && currentBackground.imageUrl
			? ""
			: shouldShowCustomBackground && currentBackground.gradient
				? `bg-gradient-to-br ${currentBackground.gradient}`
				: "bg-rainbow-gradient"; // Rainbow gradient for welcome screen

	return {
		currentPath,
		setupStep,
		gameMode,
		setGameMode,
		navigateToStep,
		navigate,
		setFullGameState,
		gameState,
		isOnlineMode,
		room,
		boardWrapperRef,
		scoreboardRef,
		players,
		glowingPlayer,
		localPlayerSlot,
		roomCode,
		handleOpenPlayerMatches,
		gameBoardContainerRef,
		flipCard,
		cardSize,
		isAnimatingCards,
		useWhiteCardBackground,
		emojiSizePercentage,
		effectiveCardBack,
		cursorSyncEnabled,
		handleCursorMove,
		handleCursorLeave,
		remoteCursorData,
		winner,
		isTie,
		handleResetClick,
		setShowCardExplorer,
		setShowBackgroundViewer,
		resetGame,
		isHost,
		handleLeaveOnlineGame,
		cancelSetupFlow,
		handleStartModalBack,
		cameFromTheme,
		isResetting,
		handleStartGame,
		handlePlayerNameChange,
		updatePlayerColor,
		handleThemeSelect,
		handleBuildCustom,
		cardPacks,
		selectedPack,
		handlePackChange,
		handleBackgroundModalBack,
		selectedBackground,
		handleBackgroundChange,
		handleCardBackModalBack,
		selectedCardBack,
		handleCardBackChange,
		handlePairCountModalBack,
		onlinePairCount,
		localPairCount,
		handlePairCountChange,
		backgroundLayerClass,
		backgroundLayerStyle,
		isPlaying,
		isStandalonePage,
		setShowReloadConfirmation,
		toggleFullscreen,
		setIsSettingsOpen,
		isFullscreen,
		setShowAdminSidebar,
		showAdminSidebar,
		adminEnabled,
		isSettingsOpen,
		autoSizeEnabled,
		flipDuration,
		ttsEnabled,
		backgroundBlurEnabled,
		increaseCardSize,
		decreaseCardSize,
		toggleAutoSize,
		toggleWhiteCardBackground,
		increaseFlipDuration,
		decreaseFlipDuration,
		increaseEmojiSize,
		decreaseEmojiSize,
		toggleTtsEnabled,
		setBackgroundBlurEnabled,
		endTurn,
		setAdminEnabled,
		isIPad,
		isRunningAsPWA,
		handleShowPWAInstall,
		setShowBuildInfo,
		onlineGame,
		disconnectState,
		showResetConfirmation,
		setShowResetConfirmation,
		handleReplay,
		handleNewGame,
		handleBackToModeSelect,
		showReloadConfirmation,
		selectedPlayerForMatches,
		setSelectedPlayerForMatches,
		showPong,
		setShowPong,
		showCardExplorer,
		showBackgroundViewer,
		currentBackground,
		endGameEarly,
		toggleAllCardsAdmin,
		setShowLogViewer,
		showLogViewer,
		showBuildInfo,
		showMobileWarning,
		handleMobileWarningClose,
		showPWAInstall,
		handlePWAInstallClose,
	};
}
export type AppModel = ReturnType<typeof useAppModel>;
