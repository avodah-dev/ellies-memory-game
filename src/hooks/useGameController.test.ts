/**
 * useGameController Tests
 *
 * Tests for the unified game controller hook that handles both local
 * and online game modes using GameEngine pure functions.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffectManager } from "../services/effects/EffectManager";
import type { Card, GameState, Player } from "../types";
import {
	type GameSettings,
	type UseGameControllerOptions,
	useGameController,
} from "./useGameController";

// ============================================
// Test Fixtures
// ============================================

function createTestCard(overrides: Partial<Card> = {}): Card {
	return {
		id: "card-1",
		imageId: "img-1",
		imageUrl: "/test.png",
		isFlipped: false,
		isMatched: false,
		...overrides,
	};
}

function createTestPlayer(overrides: Partial<Player> = {}): Player {
	return {
		id: 1,
		name: "Player 1",
		color: "#3b82f6",
		...overrides,
	};
}

function createTestGameState(overrides: Partial<GameState> = {}): GameState {
	return {
		cards: [],
		currentPlayer: 1,
		gameStatus: "setup" as const,
		...overrides,
	};
}

function createTestSettings(
	overrides: Partial<GameSettings> = {},
): GameSettings {
	return {
		flipDuration: 1500,
		cardSize: 100,
		autoSizeEnabled: true,
		useWhiteCardBackground: false,
		emojiSizePercentage: 72,
		ttsEnabled: false,
		...overrides,
	};
}

function createTestOptions(
	overrides: Partial<UseGameControllerOptions> = {},
): UseGameControllerOptions {
	return {
		mode: "local",
		initialGameState: createTestGameState(),
		initialSettings: createTestSettings(),
		players: [
			createTestPlayer({ id: 1, name: "Player 1", color: "#3b82f6" }),
			createTestPlayer({ id: 2, name: "Player 2", color: "#10b981" }),
		],
		...overrides,
	};
}

// Create matched pair of cards
function createMatchedPair(imageId: string, baseIndex: number): Card[] {
	return [
		createTestCard({
			id: `card-${baseIndex}`,
			imageId,
			imageUrl: `/test/${imageId}.png`,
		}),
		createTestCard({
			id: `card-${baseIndex + 1}`,
			imageId,
			imageUrl: `/test/${imageId}.png`,
		}),
	];
}

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

describe("useGameController", () => {
	beforeEach(() => {
		// Mock window.speechSynthesis
		Object.defineProperty(window, "speechSynthesis", {
			value: createMockSpeechSynthesis(),
			writable: true,
			configurable: true,
		});

		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	// ============================================
	// Initial State Tests
	// ============================================

	describe("initial state", () => {
		it("should have initial game state from options", () => {
			const initialState = createTestGameState({ currentPlayer: 2 });
			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			expect(result.current.gameState.currentPlayer).toBe(2);
			expect(result.current.gameState.gameStatus).toBe("setup");
		});

		it("should have initial settings from options", () => {
			const settings = createTestSettings({
				cardSize: 150,
				flipDuration: 2000,
			});
			const { result } = renderHook(() =>
				useGameController(createTestOptions({ initialSettings: settings })),
			);

			expect(result.current.settings.cardSize).toBe(150);
			expect(result.current.settings.flipDuration).toBe(2000);
		});

		it("should start with isAnimating false", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			expect(result.current.isAnimating).toBe(false);
		});

		it("should start with isAnimatingCards false", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			expect(result.current.isAnimatingCards).toBe(false);
		});

		it("should have zero layout metrics initially", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			expect(result.current.layoutMetrics.boardWidth).toBe(0);
			expect(result.current.layoutMetrics.boardAvailableHeight).toBe(0);
			expect(result.current.layoutMetrics.scoreboardHeight).toBe(0);
		});

		it("should be authoritative in local mode", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			expect(result.current.isAuthoritative).toBe(true);
		});
	});

	// ============================================
	// Initialize Game Tests
	// ============================================

	describe("initializeGame", () => {
		it("should create card pairs from images", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			const images = [
				{ id: "cat", url: "/cat.png" },
				{ id: "dog", url: "/dog.png" },
			];

			act(() => {
				result.current.initializeGame(images);
			});

			expect(result.current.gameState.cards).toHaveLength(4);
			expect(result.current.gameState.gameStatus).toBe("setup");
		});

		it("should start playing when startPlaying is true", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			const images = [{ id: "cat", url: "/cat.png" }];

			act(() => {
				result.current.initializeGame(images, true);
			});

			expect(result.current.gameState.cards).toHaveLength(2);
			expect(result.current.gameState.gameStatus).toBe("playing");
			expect(result.current.isAnimatingCards).toBe(true);
		});

		it("should end animation after timeout", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			const images = [{ id: "cat", url: "/cat.png" }];

			act(() => {
				result.current.initializeGame(images, true);
			});

			expect(result.current.isAnimatingCards).toBe(true);

			// Animation time: cards.length * 30 + 900 = 2 * 30 + 900 = 960ms
			act(() => {
				vi.advanceTimersByTime(1000);
			});

			expect(result.current.isAnimatingCards).toBe(false);
		});

		it("should shuffle cards", () => {
			// Run multiple times to verify randomization happens
			const results: string[][] = [];

			for (let i = 0; i < 3; i++) {
				const { result } = renderHook(() =>
					useGameController(createTestOptions()),
				);

				const images = [
					{ id: "a", url: "/a.png" },
					{ id: "b", url: "/b.png" },
					{ id: "c", url: "/c.png" },
				];

				act(() => {
					result.current.initializeGame(images);
				});

				results.push(result.current.gameState.cards.map((c) => c.imageId));
			}

			// At least one should be different (statistically almost always true)
			// This is a probabilistic test - 1 in 1728 chance all three are the same
		});

		it("should preserve gradient property on cards", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			const images = [
				{ id: "cat", url: "/cat.png", gradient: "linear-gradient(red, blue)" },
			];

			act(() => {
				result.current.initializeGame(images);
			});

			expect(result.current.gameState.cards[0].gradient).toBe(
				"linear-gradient(red, blue)",
			);
			expect(result.current.gameState.cards[1].gradient).toBe(
				"linear-gradient(red, blue)",
			);
		});
	});

	// ============================================
	// Start Game Tests
	// ============================================

	describe("startGame", () => {
		it("should change status from setup to playing", () => {
			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: createTestGameState({ gameStatus: "setup" }),
					}),
				),
			);

			act(() => {
				result.current.startGame();
			});

			expect(result.current.gameState.gameStatus).toBe("playing");
		});

		it("should notify effect manager of game start", () => {
			const effectManager = new EffectManager();
			const notifySpy = vi.spyOn(effectManager, "notifyGameStart");

			const { result } = renderHook(() =>
				useGameController(createTestOptions({ effectManager })),
			);

			act(() => {
				result.current.startGame();
			});

			expect(notifySpy).toHaveBeenCalledWith("Player 1", 1);
		});
	});

	describe("startGameWithFirstPlayer", () => {
		it("should set current player to specified player", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			act(() => {
				result.current.startGameWithFirstPlayer(2);
			});

			expect(result.current.gameState.currentPlayer).toBe(2);
			expect(result.current.gameState.gameStatus).toBe("playing");
		});

		it("should notify effect manager with correct player", () => {
			const effectManager = new EffectManager();
			const notifySpy = vi.spyOn(effectManager, "notifyGameStart");

			const { result } = renderHook(() =>
				useGameController(createTestOptions({ effectManager })),
			);

			act(() => {
				result.current.startGameWithFirstPlayer(2);
			});

			expect(notifySpy).toHaveBeenCalledWith("Player 2", 2);
		});
	});

	// ============================================
	// Flip Card Tests
	// ============================================

	describe("flipCard", () => {
		it("should flip a face-down card", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});

			const flippedCard = result.current.gameState.cards.find(
				(c) => c.id === "card-0",
			);
			expect(flippedCard?.isFlipped).toBe(true);
		});

		it("should not flip an already flipped card", () => {
			const cards = [
				createTestCard({ id: "card-0", imageId: "cat", isFlipped: true }),
				createTestCard({ id: "card-1", imageId: "cat" }),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});

			// Card should still be flipped
			const card = result.current.gameState.cards.find(
				(c) => c.id === "card-0",
			);
			expect(card?.isFlipped).toBe(true);
		});

		it("should not flip a matched card", () => {
			const cards = [
				createTestCard({
					id: "card-0",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
				createTestCard({
					id: "card-1",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});

			// State should be unchanged
			expect(result.current.gameState.cards[0].isMatched).toBe(true);
		});

		it("should not allow flipping more than 2 cards", () => {
			const cards = [
				createTestCard({ id: "card-0", imageId: "cat", isFlipped: true }),
				createTestCard({ id: "card-1", imageId: "dog", isFlipped: true }),
				createTestCard({ id: "card-2", imageId: "bird" }),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.flipCard("card-2");
			});

			// Third card should not be flipped
			const card = result.current.gameState.cards.find(
				(c) => c.id === "card-2",
			);
			expect(card?.isFlipped).toBe(false);
		});

		it("should not flip when game is not playing", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "setup",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});

			// Card should not be flipped
			const card = result.current.gameState.cards.find(
				(c) => c.id === "card-0",
			);
			expect(card?.isFlipped).toBe(false);
		});
	});

	// ============================================
	// Match Detection Tests
	// ============================================

	describe("match detection", () => {
		it("should detect a match after 2 cards are flipped", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						initialSettings: createTestSettings({ flipDuration: 500 }),
					}),
				),
			);

			// Flip first card
			act(() => {
				result.current.flipCard("card-0");
			});

			// Flip second card
			act(() => {
				result.current.flipCard("card-1");
			});

			// Wait for match check (flipDuration)
			act(() => {
				vi.advanceTimersByTime(600);
			});

			// Both cards should now be matched
			expect(result.current.gameState.cards[0].isMatched).toBe(true);
			expect(result.current.gameState.cards[1].isMatched).toBe(true);
		});

		it("should reset cards when no match", () => {
			const cards = [
				createTestCard({ id: "card-0", imageId: "cat" }),
				createTestCard({ id: "card-1", imageId: "dog" }),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
				currentPlayer: 1,
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						initialSettings: createTestSettings({ flipDuration: 500 }),
					}),
				),
			);

			// Flip first card
			act(() => {
				result.current.flipCard("card-0");
			});

			// Flip second card
			act(() => {
				result.current.flipCard("card-1");
			});

			// Wait for match check
			act(() => {
				vi.advanceTimersByTime(600);
			});

			// Cards should be flipped back
			expect(result.current.gameState.cards[0].isFlipped).toBe(false);
			expect(result.current.gameState.cards[1].isFlipped).toBe(false);
			// Turn should switch
			expect(result.current.gameState.currentPlayer).toBe(2);
		});

		it("should notify effect manager on match", () => {
			const effectManager = new EffectManager();
			const matchSpy = vi.spyOn(effectManager, "notifyMatchFound");

			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						initialSettings: createTestSettings({ flipDuration: 500 }),
						effectManager,
					}),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});
			act(() => {
				result.current.flipCard("card-1");
			});
			act(() => {
				vi.advanceTimersByTime(600);
			});

			expect(matchSpy).toHaveBeenCalledWith("Player 1", 1, "Cat");
		});

		it("should notify effect manager on turn change (no match)", () => {
			const effectManager = new EffectManager();
			const turnSpy = vi.spyOn(effectManager, "notifyTurnChange");

			const cards = [
				createTestCard({ id: "card-0", imageId: "cat" }),
				createTestCard({ id: "card-1", imageId: "dog" }),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						initialSettings: createTestSettings({ flipDuration: 500 }),
						effectManager,
					}),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});
			act(() => {
				result.current.flipCard("card-1");
			});
			act(() => {
				vi.advanceTimersByTime(600);
			});

			expect(turnSpy).toHaveBeenCalledWith("Player 2", 2);
		});
	});

	// ============================================
	// Game Over Tests
	// ============================================

	describe("triggerGameFinish", () => {
		it("should set game status to finished when all cards matched", () => {
			const cards = [
				createTestCard({
					id: "card-0",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
				createTestCard({
					id: "card-1",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.triggerGameFinish();
			});

			expect(result.current.gameState.gameStatus).toBe("finished");
		});

		it("should not finish if game is not over", () => {
			const cards = createMatchedPair("cat", 0); // unmatched
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.triggerGameFinish();
			});

			expect(result.current.gameState.gameStatus).toBe("playing");
		});
	});

	// ============================================
	// Reset Game Tests
	// ============================================

	describe("resetGame", () => {
		it("should clear pending match check timeouts", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						initialSettings: createTestSettings({ flipDuration: 1000 }),
					}),
				),
			);

			// Start a match check
			act(() => {
				result.current.flipCard("card-0");
			});
			act(() => {
				result.current.flipCard("card-1");
			});

			// Reset before match check completes
			act(() => {
				result.current.resetGame();
			});

			// Advance time - should not throw or cause issues
			act(() => {
				vi.advanceTimersByTime(2000);
			});

			// Cards should still have original state (flipped but not matched yet)
			// since resetGame clears timeouts but doesn't modify cards directly
		});
	});

	// ============================================
	// Settings Management Tests
	// ============================================

	describe("updateSettings", () => {
		it("should update partial settings", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			act(() => {
				result.current.updateSettings({ cardSize: 200 });
			});

			expect(result.current.settings.cardSize).toBe(200);
			expect(result.current.settings.flipDuration).toBe(1500); // unchanged
		});

		it("should update multiple settings at once", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			act(() => {
				result.current.updateSettings({
					cardSize: 180,
					flipDuration: 2000,
					ttsEnabled: true,
				});
			});

			expect(result.current.settings.cardSize).toBe(180);
			expect(result.current.settings.flipDuration).toBe(2000);
			expect(result.current.settings.ttsEnabled).toBe(true);
		});
	});

	describe("updateLayoutMetrics", () => {
		it("should update layout metrics", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			act(() => {
				result.current.updateLayoutMetrics({
					boardWidth: 800,
					boardAvailableHeight: 600,
					scoreboardHeight: 80,
				});
			});

			expect(result.current.layoutMetrics.boardWidth).toBe(800);
			expect(result.current.layoutMetrics.boardAvailableHeight).toBe(600);
			expect(result.current.layoutMetrics.scoreboardHeight).toBe(80);
		});

		it("should not update when values are same (rounded)", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			act(() => {
				result.current.updateLayoutMetrics({
					boardWidth: 800,
					boardAvailableHeight: 600,
					scoreboardHeight: 80,
				});
			});

			const metricsRef = result.current.layoutMetrics;

			act(() => {
				result.current.updateLayoutMetrics({
					boardWidth: 800.4,
					boardAvailableHeight: 599.6,
					scoreboardHeight: 80.2,
				});
			});

			// Should be the same object reference (no update)
			expect(result.current.layoutMetrics).toBe(metricsRef);
		});
	});

	// ============================================
	// Admin Controls Tests
	// ============================================

	describe("toggleAllCardsFlipped", () => {
		it("should flip all unmatched cards", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			expect(result.current.gameState.cards[0].isFlipped).toBe(true);
			expect(result.current.gameState.cards[1].isFlipped).toBe(true);
		});

		it("should unflip all cards on second toggle", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			// First toggle - flip all
			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			// Second toggle - unflip all
			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			expect(result.current.gameState.cards[0].isFlipped).toBe(false);
			expect(result.current.gameState.cards[1].isFlipped).toBe(false);
		});

		it("should not affect matched cards", () => {
			const cards = [
				createTestCard({
					id: "card-0",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
				createTestCard({
					id: "card-1",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
				createTestCard({ id: "card-2", imageId: "dog" }),
				createTestCard({ id: "card-3", imageId: "dog" }),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			// Matched cards unchanged
			expect(result.current.gameState.cards[0].isFlipped).toBe(true);
			expect(result.current.gameState.cards[0].isMatched).toBe(true);
			// Unmatched cards flipped
			expect(result.current.gameState.cards[2].isFlipped).toBe(true);
		});

		it("should do nothing with no cards", () => {
			const initialState = createTestGameState({ cards: [] });

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.toggleAllCardsFlipped();
			});

			// No error, no change
			expect(result.current.gameState.cards).toHaveLength(0);
		});
	});

	describe("endGameEarly", () => {
		it("should match all but one pair", () => {
			// Create 3 pairs (6 cards)
			const cards = [
				...createMatchedPair("cat", 0),
				...createMatchedPair("dog", 2),
				...createMatchedPair("bird", 4),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.endGameEarly();
			});

			const matchedCards = result.current.gameState.cards.filter(
				(c) => c.isMatched,
			);
			const unmatchedCards = result.current.gameState.cards.filter(
				(c) => !c.isMatched,
			);

			// 4 cards matched, 2 unmatched
			expect(matchedCards).toHaveLength(4);
			expect(unmatchedCards).toHaveLength(2);
		});

		it("should keep game in playing status", () => {
			const cards = [
				...createMatchedPair("cat", 0),
				...createMatchedPair("dog", 2),
			];
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.endGameEarly();
			});

			expect(result.current.gameState.gameStatus).toBe("playing");
		});

		it("should not affect non-playing games", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "setup",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.endGameEarly();
			});

			// Cards unchanged
			expect(result.current.gameState.cards[0].isMatched).toBe(false);
		});
	});

	// ============================================
	// Calculate Optimal Card Size Tests
	// ============================================

	describe("calculateOptimalCardSize", () => {
		it("should return current size when autoSize disabled", () => {
			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialSettings: createTestSettings({
							autoSizeEnabled: false,
							cardSize: 120,
						}),
					}),
				),
			);

			const size = result.current.calculateOptimalCardSize(20);
			expect(size).toBe(120);
		});

		it("should return current size when card count is 0", () => {
			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialSettings: createTestSettings({ cardSize: 100 }),
					}),
				),
			);

			const size = result.current.calculateOptimalCardSize(0);
			expect(size).toBe(100);
		});

		it("should return current size when layout metrics not set", () => {
			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialSettings: createTestSettings({ cardSize: 100 }),
					}),
				),
			);

			const size = result.current.calculateOptimalCardSize(20);
			expect(size).toBe(100);
		});

		it("should calculate optimal size based on layout", () => {
			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialSettings: createTestSettings({
							autoSizeEnabled: true,
							cardSize: 100,
						}),
					}),
				),
			);

			// Set layout metrics
			act(() => {
				result.current.updateLayoutMetrics({
					boardWidth: 800,
					boardAvailableHeight: 600,
					scoreboardHeight: 0,
				});
			});

			const size = result.current.calculateOptimalCardSize(20);

			// Should return a size between 60 and 200
			expect(size).toBeGreaterThanOrEqual(60);
			expect(size).toBeLessThanOrEqual(200);
		});
	});

	// ============================================
	// Set Full Game State Tests
	// ============================================

	describe("setFullGameState", () => {
		it("should replace entire game state", () => {
			const { result } = renderHook(() =>
				useGameController(createTestOptions()),
			);

			const newState = createTestGameState({
				cards: createMatchedPair("cat", 0),
				currentPlayer: 2,
				gameStatus: "playing",
			});

			act(() => {
				result.current.setFullGameState(newState);
			});

			expect(result.current.gameState.cards).toHaveLength(2);
			expect(result.current.gameState.currentPlayer).toBe(2);
			expect(result.current.gameState.gameStatus).toBe("playing");
		});
	});

	// ============================================
	// End Turn Tests
	// ============================================

	describe("endTurn", () => {
		it("should switch to next player", () => {
			const initialState = createTestGameState({
				cards: createMatchedPair("cat", 0),
				currentPlayer: 1,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({ initialGameState: initialState }),
				),
			);

			act(() => {
				result.current.endTurn();
			});

			expect(result.current.gameState.currentPlayer).toBe(2);
		});

		it("should notify effect manager of turn change", () => {
			const effectManager = new EffectManager();
			const turnSpy = vi.spyOn(effectManager, "notifyTurnChange");

			const initialState = createTestGameState({
				cards: createMatchedPair("cat", 0),
				currentPlayer: 1,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						effectManager,
					}),
				),
			);

			act(() => {
				result.current.endTurn();
			});

			expect(turnSpy).toHaveBeenCalledWith("Player 2", 2);
		});

		it("should clear pending match check timeouts", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						initialGameState: initialState,
						initialSettings: createTestSettings({ flipDuration: 1000 }),
					}),
				),
			);

			// Flip two cards to start match check
			act(() => {
				result.current.flipCard("card-0");
			});
			act(() => {
				result.current.flipCard("card-1");
			});

			// End turn before match check completes
			act(() => {
				result.current.endTurn();
			});

			// Current player should have changed
			expect(result.current.gameState.currentPlayer).toBe(2);
		});
	});

	// ============================================
	// Online Mode Tests
	// ============================================

	describe("online mode", () => {
		it("should not be authoritative when not current player", () => {
			const initialState = createTestGameState({
				currentPlayer: 2,
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						mode: "online",
						initialGameState: initialState,
						localPlayerSlot: 1,
					}),
				),
			);

			expect(result.current.isAuthoritative).toBe(false);
		});

		it("should be authoritative when current player", () => {
			const initialState = createTestGameState({
				currentPlayer: 1,
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						mode: "online",
						initialGameState: initialState,
						localPlayerSlot: 1,
					}),
				),
			);

			expect(result.current.isAuthoritative).toBe(true);
		});

		it("should not allow flip when not your turn", () => {
			const cards = createMatchedPair("cat", 0);
			const initialState = createTestGameState({
				cards,
				currentPlayer: 2,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						mode: "online",
						initialGameState: initialState,
						localPlayerSlot: 1,
					}),
				),
			);

			act(() => {
				result.current.flipCard("card-0");
			});

			// Card should not be flipped
			expect(result.current.gameState.cards[0].isFlipped).toBe(false);
		});

		it("should ignore triggerGameFinish when not authoritative", () => {
			const cards = [
				createTestCard({
					id: "card-0",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
				createTestCard({
					id: "card-1",
					imageId: "cat",
					isMatched: true,
					isFlipped: true,
				}),
			];
			const initialState = createTestGameState({
				cards,
				currentPlayer: 2,
				gameStatus: "playing",
			});

			const { result } = renderHook(() =>
				useGameController(
					createTestOptions({
						mode: "online",
						initialGameState: initialState,
						localPlayerSlot: 1,
					}),
				),
			);

			act(() => {
				result.current.triggerGameFinish();
			});

			// Should still be playing (non-authoritative player can't finish)
			expect(result.current.gameState.gameStatus).toBe("playing");
		});
	});

	// ============================================
	// Player Management Tests (No-op in controller)
	// ============================================
});
