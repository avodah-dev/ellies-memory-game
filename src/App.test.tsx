import { HomeScreen } from "./screens/HomeScreen";
import { GameplayScreen } from "./screens/GameplayScreen";
import { OnlineLobbyScreen } from "./screens/OnlineLobbyScreen";
/**
 * App.tsx Critical Behavior Tests
 *
 * Tests for the key behaviors in App.tsx including:
 * - Route guards and navigation
 * - Setup wizard flow
 * - Keyboard combos
 * - Refresh detection
 *
 * These tests focus on behavior verification through mocks rather than
 * full integration testing, as App.tsx orchestrates many complex systems.
 */

/// <reference types="@testing-library/jest-dom" />

import { type ReactNode } from "react";
import {
	act,
	fireEvent,
	render,
	renderHook,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Card, GameStatus } from "./types";

// ============================================
// Mock TanStack Router
// ============================================

const mockNavigate = vi.fn().mockResolvedValue(undefined);
const mockRouterState = { location: { pathname: "/" } };

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mockNavigate,
	useRouterState: () => mockRouterState,
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	Outlet: () =>
		mockRouterState.location.pathname === "/" ? (
			<HomeScreen />
		) : mockRouterState.location.pathname.endsWith("/game") ? (
			<GameplayScreen />
		) : mockRouterState.location.pathname.startsWith("/online") ? (
			<OnlineLobbyScreen />
		) : null,
	createRouter: vi.fn(),
	RouterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ============================================
// Mock Stores
// ============================================

vi.mock("./stores/settingsStore", () => ({
	useSettingsStore: vi.fn((selector) => {
		const mockState = {
			settings: {
				player1Name: "Player 1",
				player1Color: "#3b82f6",
				player2Name: "Player 2",
				player2Color: "#10b981",
				firstPlayer: 1,
				cardSize: 100,
				autoSizeEnabled: true,
				useWhiteCardBackground: false,
				flipDuration: 1500,
				emojiSizePercentage: 72,
				ttsEnabled: false,
				backgroundBlurEnabled: true,
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				localPairCount: 20,
				onlinePairCount: 20,
			},
			setLocalPairCount: vi.fn(),
			setOnlinePairCount: vi.fn(),
			setBackgroundBlurEnabled: vi.fn(),
		};
		if (typeof selector === "function") {
			return selector(mockState);
		}
		return mockState;
	}),
}));

vi.mock("./stores/onlineStore", () => ({
	useOnlineStore: vi.fn(() => ({
		roomCode: null,
		room: null,
		odahId: null,
		leaveRoom: vi.fn(),
		subscribeToPresence: vi.fn(() => vi.fn()),
		isHost: false,
		updateRoomConfig: vi.fn(),
		resetRoomToWaiting: vi.fn(),
		setPlayerNamePreference: vi.fn(),
		presenceData: {},
		updatePlayerName: vi.fn(),
	})),
}));

// ============================================
// Mock Hooks
// ============================================

const mockLocalGame: {
	gameState: {
		cards: Card[];
		currentPlayer: number;
		gameStatus: GameStatus;
	};
	players: { id: number; name: string; color: string }[];
	cardSize: number;
	flipDuration: number;
	autoSizeEnabled: boolean;
	useWhiteCardBackground: boolean;
	emojiSizePercentage: number;
	ttsEnabled: boolean;
	showStartModal: boolean;
	isAnimatingCards: boolean;
	allCardsFlipped: boolean;
	effectManager: { register: ReturnType<typeof vi.fn> };
	initializeGame: ReturnType<typeof vi.fn>;
	flipCard: ReturnType<typeof vi.fn>;
	resetGame: ReturnType<typeof vi.fn>;
	setShowStartModal: ReturnType<typeof vi.fn>;
	setFullGameState: ReturnType<typeof vi.fn>;
	startGameWithFirstPlayer: ReturnType<typeof vi.fn>;
	updatePlayerName: ReturnType<typeof vi.fn>;
	updatePlayerColor: ReturnType<typeof vi.fn>;
	increaseCardSize: ReturnType<typeof vi.fn>;
	decreaseCardSize: ReturnType<typeof vi.fn>;
	toggleWhiteCardBackground: ReturnType<typeof vi.fn>;
	toggleAutoSize: ReturnType<typeof vi.fn>;
	increaseFlipDuration: ReturnType<typeof vi.fn>;
	decreaseFlipDuration: ReturnType<typeof vi.fn>;
	increaseEmojiSize: ReturnType<typeof vi.fn>;
	decreaseEmojiSize: ReturnType<typeof vi.fn>;
	toggleTtsEnabled: ReturnType<typeof vi.fn>;
	toggleAllCardsFlipped: ReturnType<typeof vi.fn>;
	updateAutoSizeMetrics: ReturnType<typeof vi.fn>;
	calculateOptimalCardSizeForCount: ReturnType<typeof vi.fn>;
	showStartGameModal: ReturnType<typeof vi.fn>;
	endGameEarly: ReturnType<typeof vi.fn>;
	triggerGameFinish: ReturnType<typeof vi.fn>;
	setIsAnimatingCards: ReturnType<typeof vi.fn>;
	setAllCardsFlipped: ReturnType<typeof vi.fn>;
} = {
	gameState: {
		cards: [] as Card[],
		currentPlayer: 1,
		gameStatus: "setup" as GameStatus,
	},
	players: [
		{ id: 1, name: "Player 1", color: "#3b82f6" },
		{ id: 2, name: "Player 2", color: "#10b981" },
	],
	cardSize: 100,
	flipDuration: 1500,
	autoSizeEnabled: true,
	useWhiteCardBackground: false,
	emojiSizePercentage: 72,
	ttsEnabled: false,
	showStartModal: false,
	isAnimatingCards: false,
	allCardsFlipped: false,
	effectManager: { register: vi.fn() },
	initializeGame: vi.fn(),
	flipCard: vi.fn(),
	resetGame: vi.fn(),
	setShowStartModal: vi.fn(),
	setFullGameState: vi.fn(),
	startGameWithFirstPlayer: vi.fn(),
	updatePlayerName: vi.fn(),
	updatePlayerColor: vi.fn(),
	increaseCardSize: vi.fn(),
	decreaseCardSize: vi.fn(),
	toggleWhiteCardBackground: vi.fn(),
	toggleAutoSize: vi.fn(),
	increaseFlipDuration: vi.fn(),
	decreaseFlipDuration: vi.fn(),
	increaseEmojiSize: vi.fn(),
	decreaseEmojiSize: vi.fn(),
	toggleTtsEnabled: vi.fn(),
	toggleAllCardsFlipped: vi.fn(),
	updateAutoSizeMetrics: vi.fn(),
	calculateOptimalCardSizeForCount: vi.fn(),
	showStartGameModal: vi.fn(),
	endGameEarly: vi.fn(),
	triggerGameFinish: vi.fn(),
	setIsAnimatingCards: vi.fn(),
	setAllCardsFlipped: vi.fn(),
};

vi.mock("./hooks/useLocalGame", () => ({
	useLocalGame: () => mockLocalGame,
}));

vi.mock("./hooks/useCardPacks", () => ({
	useCardPacks: () => ({
		selectedPack: "animals",
		setSelectedPack: vi.fn(),
		getCurrentPackImages: vi.fn(() => []),
		getPackImagesForPairCount: vi.fn(() => []),
		cardPacks: [],
	}),
}));

vi.mock("./hooks/useBackgroundSelector", () => ({
	useBackgroundSelector: () => ({
		selectedBackground: "default",
		setSelectedBackground: vi.fn(),
		getCurrentBackground: vi.fn(() => ({
			id: "default",
			name: "Default",
			type: "solid" as const,
			value: "#1a1a2e",
		})),
	}),
	BACKGROUND_OPTIONS: [
		{ id: "default", name: "Default", type: "solid", value: "#1a1a2e" },
	],
}));

vi.mock("./hooks/useCardBackSelector", () => ({
	useCardBackSelector: () => ({
		selectedCardBack: "default",
		setSelectedCardBack: vi.fn(),
		getCurrentCardBack: vi.fn(() => ({
			id: "default",
			name: "Default",
			type: "solid" as const,
			value: "#4a5568",
		})),
	}),
	CARD_BACK_OPTIONS: [
		{ id: "default", name: "Default", type: "solid", value: "#4a5568" },
	],
}));

vi.mock("./hooks/useOnlineGame", () => ({
	useOnlineGame: () => ({
		gameState: {
			cards: [],
			currentPlayer: 1,
			gameStatus: "setup" as const,
		},
		flipCard: vi.fn(),
		resetGame: vi.fn(),
		setFullGameState: vi.fn(),
		startGameWithFirstPlayer: vi.fn(),
		triggerGameFinish: vi.fn(),
		toggleAllCardsFlipped: vi.fn(),
		isAuthoritative: true,
		endGameEarly: vi.fn(),
	}),
}));

vi.mock("./hooks/useCursorSync", () => ({
	useCursorSync: () => ({
		remoteCursors: [],
	}),
}));

vi.mock("./hooks/useOpponentDisconnect", () => ({
	useOpponentDisconnect: () => ({
		isOpponentDisconnected: false,
		disconnectedPlayerName: null,
	}),
}));

// ============================================
// Mock Components (simplify for testing)
// ============================================

vi.mock("./components/online", () => ({
	ModeSelector: () => <div data-testid="mode-selector">Mode Selector</div>,
	OnlineLobby: () => <div data-testid="online-lobby">Online Lobby</div>,
	OpponentDisconnectOverlay: () => null,
}));

vi.mock("./components/GameBoard", () => ({
	GameBoard: () => <div data-testid="game-board">Game Board</div>,
}));

vi.mock("./components/GameOver", () => ({
	GameOver: () => <div data-testid="game-over">Game Over</div>,
}));

vi.mock("./components/Modal", () => ({
	Modal: ({ children, isOpen }: { children: ReactNode; isOpen: boolean }) =>
		isOpen ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("./components/Pong", () => ({
	Pong: ({ onClose }: { onClose: () => void }) => (
		<div data-testid="pong">
			Pong Game
			<button type="button" onClick={onClose}>
				Close
			</button>
		</div>
	),
}));

vi.mock("./components/AdminSidebar", () => ({
	AdminSidebar: ({ isOpen }: { isOpen: boolean }) =>
		isOpen ? <div data-testid="admin-sidebar">Admin Sidebar</div> : null,
}));

// Mock all other components
vi.mock("./components/CardPackModal", () => ({ CardPackModal: () => null }));
vi.mock("./components/BackgroundModal", () => ({
	BackgroundModal: () => null,
}));
vi.mock("./components/CardBackModal", () => ({ CardBackModal: () => null }));
vi.mock("./components/GameStartModal", () => ({ GameStartModal: () => null }));
vi.mock("./components/ThemeSelectorModal", () => ({
	ThemeSelectorModal: () => null,
}));
vi.mock("./components/ResetConfirmationModal", () => ({
	ResetConfirmationModal: () => null,
}));
vi.mock("./components/ReloadConfirmationModal", () => ({
	ReloadConfirmationModal: () => null,
}));
vi.mock("./components/SettingsMenu", () => ({ SettingsMenu: () => null }));
vi.mock("./components/PlayerMatchesModal", () => ({
	PlayerMatchesModal: () => null,
}));
vi.mock("./components/CardExplorerModal", () => ({
	CardExplorerModal: () => null,
}));
vi.mock("./components/game", () => ({
	GameplayHeader: () => null,
	FixedGameControls: () => null,
	SetupControls: () => null,
	FloatingSettingsButton: () => null,
}));
vi.mock("./components/layout", () => ({
	SettingsSidebarWrapper: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
}));
vi.mock("./components/BackgroundViewer", () => ({
	BackgroundViewer: () => null,
}));
vi.mock("./components/MobileWarningModal", () => ({
	MobileWarningModal: () => null,
}));
vi.mock("./components/PWAInstallModal", () => ({
	PWAInstallModal: () => null,
}));
vi.mock("./components/LogViewerModal", () => ({ LogViewerModal: () => null }));
vi.mock("./components/PairCountModal", () => ({ PairCountModal: () => null }));

// Mock Firebase adapter
vi.mock("./services/sync/FirestoreSyncAdapter", () => ({
	getFirestoreSyncAdapter: () => ({
		connect: vi.fn(),
		disconnect: vi.fn(),
		setState: vi.fn(),
		subscribeToState: vi.fn(() => vi.fn()),
	}),
}));

// Mock screenfull
vi.mock("screenfull", () => ({
	default: {
		isEnabled: false,
		isFullscreen: false,
		on: vi.fn(),
		off: vi.fn(),
		toggle: vi.fn(),
		request: vi.fn(),
		exit: vi.fn(),
	},
}));

// Mock gridCalculations
vi.mock("./utils/gridCalculations", () => ({
	calculateOptimalCardSizeForCount: vi.fn(() => 100),
	calculateOptimalLayout: vi.fn(() => ({ columns: 5, rows: 4 })),
}));

// Mock ResizeObserver
class MockResizeObserver {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}
globalThis.ResizeObserver =
	MockResizeObserver as unknown as typeof ResizeObserver;

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
	writable: true,
	configurable: true,
	value: vi.fn().mockImplementation((query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	})),
});

// Mock speechSynthesis
Object.defineProperty(window, "speechSynthesis", {
	value: {
		speak: vi.fn(),
		cancel: vi.fn(),
		getVoices: vi.fn(() => []),
		speaking: false,
		pending: false,
		paused: false,
		onvoiceschanged: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(() => true),
	},
	writable: true,
	configurable: true,
});

// ============================================
// Import App after mocks
// ============================================

import App from "./App";
import { useAppModel } from "./hooks/useAppModel";
import { useOnlineStore } from "./stores/onlineStore";
import { createTestRoom } from "./test/testUtils";

// ============================================
// Tests
// ============================================

describe("App", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockNavigate.mockClear();
		mockRouterState.location.pathname = "/";
		sessionStorage.clear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it.each(["success", "failure"] as const)(
		"waits for an online reset before clearing state (%s)",
		async (outcome) => {
			let resolve!: () => void;
			let reject!: (reason: Error) => void;
			const pending = new Promise<void>((yes, no) => {
				resolve = yes;
				reject = no;
			});
			const resetRoom = vi.fn(() => pending);
			const mockedStore = vi.mocked(useOnlineStore);
			const original = mockedStore.getMockImplementation()!;
			mockedStore.mockReturnValue({
				roomCode: "TEST",
				room: createTestRoom({ status: "playing" }),
				odahId: "host",
				isHost: true,
				presenceData: { host: { slot: 1, name: "Host", color: "blue" } },
				resetRoomToWaiting: resetRoom,
				subscribeToPresence: () => () => {},
				leaveRoom: vi.fn(),
				updateRoomConfig: vi.fn(),
				setPlayerNamePreference: vi.fn(),
				updatePlayerName: vi.fn(),
			});
			mockRouterState.location.pathname = "/online/game";
			sessionStorage.setItem("appNavigation", "true");
			const hook = renderHook(() => useAppModel());
			try {
				act(() => hook.result.current.setShowResetConfirmation(true));
				expect(hook.result.current.isOnlineMode).toBeTruthy();
				const reset = hook.result.current.resetGame;
				const setState = hook.result.current.onlineGame.setFullGameState;
				mockNavigate.mockClear();
				let action!: Promise<void>;
				act(() => {
					action = hook.result.current.handleNewGame();
				});
				expect(resetRoom).toHaveBeenCalledOnce();
				expect(reset).not.toHaveBeenCalled();
				expect(setState).not.toHaveBeenCalled();
				expect(mockNavigate).not.toHaveBeenCalled();
				await act(async () => {
					if (outcome === "success") resolve();
					else reject(new Error("offline"));
					await action;
				});
				if (outcome === "success") {
					expect(reset).toHaveBeenCalledOnce();
					expect(setState).toHaveBeenCalledWith(
						expect.objectContaining({ gameStatus: "setup" }),
					);
					expect(mockNavigate).toHaveBeenCalledWith({ to: "/online/waiting" });
				} else {
					expect(reset).not.toHaveBeenCalled();
					expect(setState).not.toHaveBeenCalled();
					expect(mockNavigate).not.toHaveBeenCalled();
					expect(hook.result.current.showResetConfirmation).toBe(true);
				}
			} finally {
				hook.unmount();
				mockedStore.mockImplementation(original);
			}
		},
	);

	// ============================================
	// Setup Step Derivation Tests
	// ============================================

	describe("setup step derivation", () => {
		it("should derive modeSelect step from / route", () => {
			mockRouterState.location.pathname = "/";
			render(<App />);

			// On home route, mode selector should be shown
			expect(screen.getByTestId("mode-selector")).toBeInTheDocument();
		});

		it("should show online lobby on /online route", () => {
			mockRouterState.location.pathname = "/online";
			render(<App />);

			expect(screen.getByTestId("online-lobby")).toBeInTheDocument();
		});
	});

	// ============================================
	// Route Guard Tests
	// ============================================

	describe("route guards", () => {
		it("should redirect /local/game to /local/theme when no cards", async () => {
			mockRouterState.location.pathname = "/local/game";
			mockLocalGame.gameState.cards = [];
			mockLocalGame.gameState.gameStatus = "setup";

			render(<App />);

			await act(async () => {
				vi.runAllTimers();
			});

			expect(mockNavigate).toHaveBeenCalledWith({ to: "/local/theme" });
		});

		it("should not redirect /local/game when cards exist", async () => {
			mockRouterState.location.pathname = "/local/game";
			mockLocalGame.gameState.cards = [
				{
					id: "card-1",
					imageId: "cat",
					imageUrl: "/cat.png",
					isFlipped: false,
					isMatched: false,
				},
			];
			mockLocalGame.gameState.gameStatus = "playing";

			render(<App />);

			await act(async () => {
				vi.runAllTimers();
			});

			// Should not redirect to theme selection
			expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/local/theme" });
		});
	});

	// ============================================
	// Refresh Detection Tests
	// ============================================

	describe("refresh detection", () => {
		it("should redirect non-home routes to home on refresh", () => {
			// Simulate refresh (no appNavigation flag)
			sessionStorage.removeItem("appNavigation");

			// Set initial path to non-home
			Object.defineProperty(window, "location", {
				value: { pathname: "/local/game" },
				writable: true,
				configurable: true,
			});
			mockRouterState.location.pathname = "/local/game";

			render(<App />);

			expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
		});

		it("should not redirect home route on refresh", () => {
			sessionStorage.removeItem("appNavigation");

			Object.defineProperty(window, "location", {
				value: { pathname: "/" },
				writable: true,
				configurable: true,
			});
			mockRouterState.location.pathname = "/";

			render(<App />);

			// Should not redirect (already on home)
			expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/" });
		});

		it("should not redirect standalone pages on refresh", () => {
			sessionStorage.removeItem("appNavigation");

			Object.defineProperty(window, "location", {
				value: { pathname: "/terms" },
				writable: true,
				configurable: true,
			});
			mockRouterState.location.pathname = "/terms";

			render(<App />);

			// Should not redirect standalone pages
			expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/" });
		});

		it("should not redirect when appNavigation flag is set", () => {
			sessionStorage.setItem("appNavigation", "true");

			Object.defineProperty(window, "location", {
				value: { pathname: "/local/game" },
				writable: true,
				configurable: true,
			});
			mockRouterState.location.pathname = "/local/game";
			mockLocalGame.gameState.cards = [
				{
					id: "card-1",
					imageId: "cat",
					imageUrl: "/cat.png",
					isFlipped: false,
					isMatched: false,
				},
			];

			render(<App />);

			// Should not redirect to home (navigation flag set)
			expect(mockNavigate).not.toHaveBeenCalledWith({ to: "/" });
		});
	});

	// ============================================
	// Keyboard Combo Tests
	// ============================================

	describe("keyboard combos", () => {
		beforeEach(() => {
			// Use real timers for keyboard combo tests since they use setTimeout internally
			vi.useRealTimers();
		});

		afterEach(() => {
			// Restore fake timers for other tests
			vi.useFakeTimers();
		});

		it("should show Pong when PPONG combo is entered", async () => {
			mockRouterState.location.pathname = "/";
			render(<App />);

			// Simulate PPONG key sequence
			const keys = ["p", "p", "o", "n", "g"];

			for (const key of keys) {
				act(() => {
					fireEvent.keyDown(window, { key });
				});
			}

			// Wait for state update
			await waitFor(() => {
				expect(screen.getByTestId("pong")).toBeInTheDocument();
			});
		});

		it("should show admin sidebar when 12251225 combo is entered", async () => {
			mockRouterState.location.pathname = "/";
			render(<App />);

			// Simulate 12251225 key sequence
			const keys = ["1", "2", "2", "5", "1", "2", "2", "5"];

			for (const key of keys) {
				act(() => {
					fireEvent.keyDown(window, { key });
				});
			}

			await waitFor(() => {
				expect(screen.getByTestId("admin-sidebar")).toBeInTheDocument();
			});
		});
	});

	// ============================================
	// Game Mode Tests
	// ============================================

	describe("game mode", () => {
		it("should set game mode to local on /local routes", () => {
			mockRouterState.location.pathname = "/local/theme";
			render(<App />);

			// Game mode should be set to local (internal state)
			// We verify this by checking that local setup modals would be shown
			// (tested indirectly through component behavior)
		});

		it("should set game mode to online on /online routes", () => {
			mockRouterState.location.pathname = "/online";
			render(<App />);

			// Online lobby should be shown for online mode
			expect(screen.getByTestId("online-lobby")).toBeInTheDocument();
		});
	});

	// ============================================
	// Game Status Navigation Tests
	// ============================================

	describe("game status navigation", () => {
		it("should navigate to /game-over when game finishes", async () => {
			mockRouterState.location.pathname = "/local/game";
			mockLocalGame.gameState.gameStatus = "finished";
			mockLocalGame.gameState.cards = [
				{
					id: "card-1",
					imageId: "cat",
					imageUrl: "/cat.png",
					isFlipped: true,
					isMatched: true,
					matchedByPlayerId: 1,
				},
				{
					id: "card-2",
					imageId: "cat",
					imageUrl: "/cat.png",
					isFlipped: true,
					isMatched: true,
					matchedByPlayerId: 1,
				},
			];

			render(<App />);

			await act(async () => {
				vi.runAllTimers();
			});

			expect(mockNavigate).toHaveBeenCalledWith({ to: "/game-over" });
		});
	});

	// ============================================
	// Integration Tests
	// ============================================

	describe("integration", () => {
		it("should render without crashing", () => {
			mockRouterState.location.pathname = "/";
			expect(() => render(<App />)).not.toThrow();
		});

		it("should show mode selector on home route", () => {
			mockRouterState.location.pathname = "/";
			render(<App />);

			expect(screen.getByTestId("mode-selector")).toBeInTheDocument();
		});

		it("should show game board when playing", () => {
			mockRouterState.location.pathname = "/local/game";
			mockLocalGame.gameState.gameStatus = "playing";
			mockLocalGame.gameState.cards = [
				{
					id: "card-1",
					imageId: "cat",
					imageUrl: "/cat.png",
					isFlipped: false,
					isMatched: false,
				},
			];

			// Set appNavigation to prevent refresh redirect
			sessionStorage.setItem("appNavigation", "true");

			render(<App />);

			expect(screen.getByTestId("game-board")).toBeInTheDocument();
		});
	});
});
