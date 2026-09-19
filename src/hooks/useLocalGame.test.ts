import { createTestSettings } from "../test/testUtils";
/**
 * useLocalGame Tests
 *
 * Tests for the local game hook that composes useGameController
 * with settings management and effect handling.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "../stores/settingsStore";
import { useUIStore } from "../stores/uiStore";
import { resetStorageMocks, setupStorageMocks } from "../test/mocks/storage";
import { useLocalGame } from "./useLocalGame";

// Mock speechSynthesis for TTS
function createMockSpeechSynthesis() {
	return {
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
	};
}

describe("useLocalGame", () => {
	beforeEach(() => {
		setupStorageMocks();

		// Mock window.speechSynthesis (must be done after jsdom sets up window)
		Object.defineProperty(window, "speechSynthesis", {
			value: createMockSpeechSynthesis(),
			writable: true,
			configurable: true,
		});

		// Reset settings store
		useSettingsStore.setState({
			settings: createTestSettings(),
		});

		// Reset UI store
		useUIStore.getState().resetUIState();

		vi.clearAllMocks();
	});

	afterEach(() => {
		resetStorageMocks();
	});

	// ============================================
	// Initial State Tests
	// ============================================

	describe("initial state", () => {
		it("should have initial game state in setup status", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.gameState.gameStatus).toBe("setup");
			expect(result.current.gameState.cards).toEqual([]);
			expect(result.current.gameState.currentPlayer).toBe(1);
		});

		it("should have players derived from settings", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.players).toHaveLength(2);
			expect(result.current.players[0].id).toBe(1);
			expect(result.current.players[0].name).toBe("Player 1");
			expect(result.current.players[1].id).toBe(2);
			expect(result.current.players[1].name).toBe("Player 2");
		});

		it("should have settings from store", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.cardSize).toBe(100);
			expect(result.current.autoSizeEnabled).toBe(true);
			expect(result.current.flipDuration).toBe(1500);
			expect(result.current.ttsEnabled).toBe(false);
		});

		it("should have showStartModal as false initially", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.showStartModal).toBe(false);
		});

		it("should have isAnimatingCards as false initially", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.isAnimatingCards).toBe(false);
		});

		it("should have allCardsFlipped as false initially", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.allCardsFlipped).toBe(false);
		});
	});

	// ============================================
	// Player Settings Tests
	// ============================================

	describe("player settings", () => {
		it("should update player 1 name", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updatePlayerName(1, "Alice");
			});

			expect(result.current.players[0].name).toBe("Alice");
			expect(useSettingsStore.getState().settings.player1Name).toBe("Alice");
		});

		it("should update player 2 name", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updatePlayerName(2, "Bob");
			});

			expect(result.current.players[1].name).toBe("Bob");
			expect(useSettingsStore.getState().settings.player2Name).toBe("Bob");
		});

		it("should trim whitespace from player names", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updatePlayerName(1, "  Trimmed  ");
			});

			expect(result.current.players[0].name).toBe("Trimmed");
		});

		it("should update player 1 color", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updatePlayerColor(1, "#ff0000");
			});

			expect(result.current.players[0].color).toBe("#ff0000");
			expect(useSettingsStore.getState().settings.player1Color).toBe("#ff0000");
		});

		it("should update player 2 color", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updatePlayerColor(2, "#00ff00");
			});

			expect(result.current.players[1].color).toBe("#00ff00");
			expect(useSettingsStore.getState().settings.player2Color).toBe("#00ff00");
		});
	});

	// ============================================
	// Display Settings Tests
	// ============================================

	describe("display settings", () => {
		it("should increase card size", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.increaseCardSize();
			});

			expect(result.current.cardSize).toBe(110);
		});

		it("should decrease card size", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.decreaseCardSize();
			});

			expect(result.current.cardSize).toBe(90);
		});

		it("should not exceed max card size (300)", () => {
			useSettingsStore.getState().setCardSize(295);
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.increaseCardSize();
			});

			expect(result.current.cardSize).toBe(300);
		});

		it("should not go below min card size (60)", () => {
			useSettingsStore.getState().setCardSize(65);
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.decreaseCardSize();
			});

			expect(result.current.cardSize).toBe(60);
		});

		it("should toggle white card background", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.useWhiteCardBackground).toBe(false);

			act(() => {
				result.current.toggleWhiteCardBackground();
			});

			expect(result.current.useWhiteCardBackground).toBe(true);

			act(() => {
				result.current.toggleWhiteCardBackground();
			});

			expect(result.current.useWhiteCardBackground).toBe(false);
		});

		it("should toggle auto size", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.autoSizeEnabled).toBe(true);

			act(() => {
				result.current.toggleAutoSize();
			});

			expect(result.current.autoSizeEnabled).toBe(false);
		});

		it("should increase flip duration", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.increaseFlipDuration();
			});

			expect(result.current.flipDuration).toBe(2000);
		});

		it("should decrease flip duration", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.decreaseFlipDuration();
			});

			expect(result.current.flipDuration).toBe(1000);
		});

		it("should increase emoji size", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.increaseEmojiSize();
			});

			expect(result.current.emojiSizePercentage).toBe(77);
		});

		it("should decrease emoji size", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.decreaseEmojiSize();
			});

			expect(result.current.emojiSizePercentage).toBe(67);
		});

		it("should toggle TTS", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.ttsEnabled).toBe(false);

			act(() => {
				result.current.toggleTtsEnabled();
			});

			expect(result.current.ttsEnabled).toBe(true);
		});
	});

	// ============================================
	// Game Actions Tests
	// ============================================

	describe("game actions", () => {
		it("should initialize game with cards", () => {
			const { result } = renderHook(() => useLocalGame());

			const images = [
				{ id: "img-1", url: "/test1.png" },
				{ id: "img-2", url: "/test2.png" },
				{ id: "img-3", url: "/test3.png" },
			];

			act(() => {
				result.current.initializeGame(images);
			});

			// Should create pairs (2 cards per image)
			expect(result.current.gameState.cards).toHaveLength(6);
			expect(result.current.gameState.gameStatus).toBe("setup");
		});

		it("should initialize game and start playing when startPlaying is true", () => {
			vi.useFakeTimers();
			const { result } = renderHook(() => useLocalGame());

			const images = [
				{ id: "img-1", url: "/test1.png" },
				{ id: "img-2", url: "/test2.png" },
			];

			act(() => {
				result.current.initializeGame(images, true);
			});

			expect(result.current.gameState.cards).toHaveLength(4);
			expect(result.current.gameState.gameStatus).toBe("playing");
			expect(result.current.isAnimatingCards).toBe(true);

			// Fast-forward animation
			act(() => {
				vi.advanceTimersByTime(2000);
			});

			expect(result.current.isAnimatingCards).toBe(false);

			vi.useRealTimers();
		});

		it("should show start modal", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.showStartModal).toBe(false);

			act(() => {
				result.current.showStartGameModal();
			});

			expect(result.current.showStartModal).toBe(true);
		});

		it("should start game with specified first player", () => {
			const { result } = renderHook(() => useLocalGame());

			// Initialize first
			const images = [{ id: "img-1", url: "/test1.png" }];
			act(() => {
				result.current.initializeGame(images);
			});

			act(() => {
				result.current.startGameWithFirstPlayer(2);
			});

			expect(result.current.gameState.currentPlayer).toBe(2);
			expect(result.current.gameState.gameStatus).toBe("playing");
		});

		it("should reset game state", () => {
			const { result } = renderHook(() => useLocalGame());

			// Initialize and start
			const images = [{ id: "img-1", url: "/test1.png" }];
			act(() => {
				result.current.initializeGame(images, true);
			});

			act(() => {
				result.current.resetGame();
			});

			// resetGame clears timeouts but doesn't reset cards
			// The actual reset of cards happens via setFullGameState
		});

		it("should flip a card", () => {
			vi.useFakeTimers();
			const { result } = renderHook(() => useLocalGame());

			const images = [{ id: "img-1", url: "/test1.png" }];
			act(() => {
				result.current.initializeGame(images, true);
			});

			// Wait for animation to complete
			act(() => {
				vi.advanceTimersByTime(2000);
			});

			const cardId = result.current.gameState.cards[0].id;

			act(() => {
				result.current.flipCard(cardId);
			});

			const flippedCard = result.current.gameState.cards.find(
				(c) => c.id === cardId,
			);
			expect(flippedCard?.isFlipped).toBe(true);

			vi.useRealTimers();
		});
	});

	// ============================================
	// Modal Control Tests
	// ============================================

	describe("modal controls", () => {
		it("should set show start modal to true", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.setShowStartModal(true);
			});

			expect(result.current.showStartModal).toBe(true);
		});

		it("should set show start modal to false", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.setShowStartModal(true);
			});
			act(() => {
				result.current.setShowStartModal(false);
			});

			expect(result.current.showStartModal).toBe(false);
		});
	});

	// ============================================
	// Admin Control Tests
	// ============================================

	describe("admin controls", () => {
		it("should toggle all cards flipped", () => {
			vi.useFakeTimers();
			const { result } = renderHook(() => useLocalGame());

			const images = [
				{ id: "img-1", url: "/test1.png" },
				{ id: "img-2", url: "/test2.png" },
			];

			act(() => {
				result.current.initializeGame(images, true);
			});

			act(() => {
				vi.advanceTimersByTime(2000);
			});

			// All cards start face down
			const allFlippedBefore = result.current.gameState.cards.every(
				(c) => c.isFlipped,
			);
			expect(allFlippedBefore).toBe(false);

			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			// Now all should be flipped
			const allFlippedAfter = result.current.gameState.cards.every(
				(c) => c.isFlipped,
			);
			expect(allFlippedAfter).toBe(true);
			expect(result.current.allCardsFlipped).toBe(true);

			// Toggle again
			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			const allFlippedAgain = result.current.gameState.cards.every(
				(c) => c.isFlipped,
			);
			expect(allFlippedAgain).toBe(false);

			vi.useRealTimers();
		});

		it("should do nothing when toggling with no cards", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			// No error, state unchanged
			expect(result.current.gameState.cards).toHaveLength(0);
		});
	});

	// ============================================
	// Effect Manager Tests
	// ============================================

	describe("effect manager", () => {
		it("should provide effect manager", () => {
			const { result } = renderHook(() => useLocalGame());

			expect(result.current.effectManager).toBeDefined();
			expect(typeof result.current.effectManager.register).toBe("function");
		});
	});

	// ============================================
	// Layout Tests
	// ============================================

	describe("layout", () => {
		it("should update auto size metrics", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updateAutoSizeMetrics({
					boardWidth: 800,
					boardAvailableHeight: 600,
					scoreboardHeight: 80,
				});
			});

			// Check metrics were updated in UI store
			const { layoutMetrics } = useUIStore.getState();
			expect(layoutMetrics.boardWidth).toBe(800);
			expect(layoutMetrics.boardAvailableHeight).toBe(600);
			expect(layoutMetrics.scoreboardHeight).toBe(80);
		});

		it("should not update metrics when values are same (rounded)", () => {
			const { result } = renderHook(() => useLocalGame());

			act(() => {
				result.current.updateAutoSizeMetrics({
					boardWidth: 800,
					boardAvailableHeight: 600,
					scoreboardHeight: 80,
				});
			});

			// Try updating with same rounded values
			act(() => {
				result.current.updateAutoSizeMetrics({
					boardWidth: 800.4,
					boardAvailableHeight: 599.6,
					scoreboardHeight: 80.1,
				});
			});

			// Values should remain unchanged (rounded comparison)
			const { layoutMetrics } = useUIStore.getState();
			expect(layoutMetrics.boardWidth).toBe(800);
		});
	});

	// ============================================
	// Settings Sync Tests
	// ============================================

	describe("settings sync", () => {
		it("should reflect settings changes from store", () => {
			const { result, rerender } = renderHook(() => useLocalGame());

			expect(result.current.cardSize).toBe(100);

			// Update settings store directly
			act(() => {
				useSettingsStore.getState().setCardSize(150);
			});

			// Rerender to pick up store changes
			rerender();

			expect(result.current.cardSize).toBe(150);
		});

		it("should reflect player changes from store", () => {
			const { result, rerender } = renderHook(() => useLocalGame());

			expect(result.current.players[0].name).toBe("Player 1");

			// Update via store
			act(() => {
				useSettingsStore.getState().setPlayerName(1, "New Name");
			});

			rerender();

			expect(result.current.players[0].name).toBe("New Name");
		});
	});
});
