import { describe, expect, it } from "vitest";
import type { Card, GameState, Player } from "../../types";
import {
	applyMatch,
	applyNoMatchWithReset,
	type CardImage,
	calculateWinner,
	canFlipCard,
	checkAndFinishGame,
	checkMatch,
	createCardPairs,
	createInitialState,
	endTurn,
	finishGame,
	flipCard,
	generateRoomCode,
	getNextPlayer,
	getPlayerById,
	getPlayerScore,
	getPlayersFromSettings,
	getSelectedCardIds,
	initializeCards,
	isGameOver,
	resetGameState,
	shuffleCards,
	sortPlayersByID,
	startGameWithCards,
	switchPlayer,
	validateState,
} from "./GameEngine";

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

function createTestState(overrides: Partial<GameState> = {}): GameState {
	return {
		cards: [],
		currentPlayer: 1,
		gameStatus: "playing",
		...overrides,
	};
}

// Default test players derived from settings (for tests that need player data)
function getTestPlayers(): Player[] {
	return [
		createTestPlayer({ id: 1, name: "Player 1" }),
		createTestPlayer({ id: 2, name: "Player 2", color: "#10b981" }),
	];
}

function createMatchingCardPair(): Card[] {
	return [
		createTestCard({ id: "card-0", imageId: "img-1" }),
		createTestCard({ id: "card-1", imageId: "img-1" }),
	];
}

function createNonMatchingCards(): Card[] {
	return [
		createTestCard({ id: "card-0", imageId: "img-1" }),
		createTestCard({ id: "card-1", imageId: "img-2" }),
	];
}

// ============================================
// Helper Functions Tests
// ============================================

describe("Helper Functions", () => {
	describe("sortPlayersByID", () => {
		it("sorts players by ID in ascending order", () => {
			const players = [
				createTestPlayer({ id: 2 }),
				createTestPlayer({ id: 1 }),
			];
			const sorted = sortPlayersByID(players);
			expect(sorted[0].id).toBe(1);
			expect(sorted[1].id).toBe(2);
		});

		it("does not mutate original array", () => {
			const players = [
				createTestPlayer({ id: 2 }),
				createTestPlayer({ id: 1 }),
			];
			sortPlayersByID(players);
			expect(players[0].id).toBe(2);
		});
	});

	describe("getPlayerById", () => {
		it("returns player with matching ID", () => {
			const players = [
				createTestPlayer({ id: 1, name: "Alice" }),
				createTestPlayer({ id: 2, name: "Bob" }),
			];
			const player = getPlayerById(players, 2);
			expect(player?.name).toBe("Bob");
		});

		it("returns undefined for non-existent ID", () => {
			const players = [createTestPlayer({ id: 1 })];
			const player = getPlayerById(players, 99);
			expect(player).toBeUndefined();
		});
	});

	describe("generateRoomCode", () => {
		it("generates a 4-character code", () => {
			const code = generateRoomCode();
			expect(code).toHaveLength(4);
		});

		it("generates uppercase letters only", () => {
			const code = generateRoomCode();
			expect(code).toMatch(/^[A-Z]+$/);
		});

		it("excludes ambiguous characters O and I", () => {
			// Generate many codes to increase chance of catching violations
			for (let i = 0; i < 100; i++) {
				const code = generateRoomCode();
				expect(code).not.toContain("O");
				expect(code).not.toContain("I");
			}
		});
	});
});

// ============================================
// Card Initialization Tests
// ============================================

describe("Card Initialization", () => {
	describe("createCardPairs", () => {
		it("creates two cards for each image", () => {
			const images: CardImage[] = [
				{ id: "img-1", url: "/1.png" },
				{ id: "img-2", url: "/2.png" },
			];
			const cards = createCardPairs(images);
			expect(cards).toHaveLength(4);
		});

		it("creates cards with matching imageIds for pairs", () => {
			const images: CardImage[] = [{ id: "img-1", url: "/1.png" }];
			const cards = createCardPairs(images);
			expect(cards[0].imageId).toBe(cards[1].imageId);
		});

		it("creates cards with unique IDs", () => {
			const images: CardImage[] = [
				{ id: "img-1", url: "/1.png" },
				{ id: "img-2", url: "/2.png" },
			];
			const cards = createCardPairs(images);
			const ids = cards.map((c) => c.id);
			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(ids.length);
		});

		it("initializes cards as not flipped and not matched", () => {
			const images: CardImage[] = [{ id: "img-1", url: "/1.png" }];
			const cards = createCardPairs(images);
			cards.forEach((card) => {
				expect(card.isFlipped).toBe(false);
				expect(card.isMatched).toBe(false);
			});
		});
	});

	describe("shuffleCards", () => {
		it("returns same number of cards", () => {
			const cards = [
				createTestCard({ id: "1" }),
				createTestCard({ id: "2" }),
				createTestCard({ id: "3" }),
			];
			const shuffled = shuffleCards(cards);
			expect(shuffled).toHaveLength(cards.length);
		});

		it("does not mutate original array", () => {
			const cards = [createTestCard({ id: "1" }), createTestCard({ id: "2" })];
			const originalFirst = cards[0];
			shuffleCards(cards);
			expect(cards[0]).toBe(originalFirst);
		});

		it("contains all original cards", () => {
			const cards = [
				createTestCard({ id: "1" }),
				createTestCard({ id: "2" }),
				createTestCard({ id: "3" }),
			];
			const shuffled = shuffleCards(cards);
			cards.forEach((card) => {
				expect(shuffled).toContainEqual(card);
			});
		});
	});

	describe("initializeCards", () => {
		it("creates and shuffles card pairs", () => {
			const images: CardImage[] = [
				{ id: "img-1", url: "/1.png" },
				{ id: "img-2", url: "/2.png" },
			];
			const cards = initializeCards(images);
			expect(cards).toHaveLength(4);
		});
	});
});

// ============================================
// Card Operations Tests
// ============================================

describe("Card Operations", () => {
	describe("canFlipCard", () => {
		it("returns false if game not playing", () => {
			const state = createTestState({
				gameStatus: "setup",
				cards: [createTestCard()],
			});
			expect(canFlipCard(state, "card-1")).toBe(false);
		});

		it("returns false if 2 cards already selected", () => {
			const state = createTestState({
				cards: [
					createTestCard({ id: "card-a", isFlipped: true }),
					createTestCard({ id: "card-b", isFlipped: true }),
					createTestCard({ id: "card-1" }),
				],
			});
			expect(canFlipCard(state, "card-1")).toBe(false);
		});

		it("returns false if card not found", () => {
			const state = createTestState({ cards: [] });
			expect(canFlipCard(state, "nonexistent")).toBe(false);
		});

		it("returns false if card already flipped", () => {
			const state = createTestState({
				cards: [createTestCard({ isFlipped: true })],
			});
			expect(canFlipCard(state, "card-1")).toBe(false);
		});

		it("returns false if card already matched", () => {
			const state = createTestState({
				cards: [createTestCard({ isMatched: true })],
			});
			expect(canFlipCard(state, "card-1")).toBe(false);
		});

		it("returns true for valid flip", () => {
			const state = createTestState({
				cards: [createTestCard()],
			});
			expect(canFlipCard(state, "card-1")).toBe(true);
		});

		it("returns true when one card already selected", () => {
			const state = createTestState({
				cards: [
					createTestCard({ id: "card-1", isFlipped: true }),
					createTestCard({ id: "card-2" }),
				],
			});
			expect(canFlipCard(state, "card-2")).toBe(true);
		});
	});

	describe("flipCard", () => {
		it("flips the specified card", () => {
			const state = createTestState({
				cards: [createTestCard({ id: "card-1", isFlipped: false })],
			});
			const newState = flipCard(state, "card-1");
			expect(newState.cards[0].isFlipped).toBe(true);
		});

		it("adds card to selected (derived from flipped cards)", () => {
			const state = createTestState({
				cards: [createTestCard()],
			});
			const newState = flipCard(state, "card-1");
			expect(getSelectedCardIds(newState.cards)).toContain("card-1");
		});

		it("returns unchanged state if invalid flip", () => {
			const state = createTestState({
				cards: [createTestCard({ isFlipped: true })],
			});
			const newState = flipCard(state, "card-1");
			expect(newState).toBe(state);
		});

		it("does not mutate original state", () => {
			const state = createTestState({
				cards: [createTestCard()],
			});
			flipCard(state, "card-1");
			expect(state.cards[0].isFlipped).toBe(false);
		});
	});
});

// ============================================
// Match Detection Tests
// ============================================

describe("Match Detection", () => {
	describe("checkMatch", () => {
		it("returns null if less than 2 cards selected", () => {
			const cards = createMatchingCardPair();
			cards[0].isFlipped = true; // Only one card flipped
			const state = createTestState({
				cards,
			});
			expect(checkMatch(state)).toBeNull();
		});

		it("returns null if selected cards not found", () => {
			const state = createTestState({
				cards: [], // No cards to match
			});
			expect(checkMatch(state)).toBeNull();
		});

		it("returns isMatch: true for matching imageIds", () => {
			const cards = createMatchingCardPair();
			cards[0].isFlipped = true;
			cards[1].isFlipped = true;
			const state = createTestState({
				cards,
			});
			const result = checkMatch(state);
			expect(result?.isMatch).toBe(true);
		});

		it("returns isMatch: false for different imageIds", () => {
			const cards = createNonMatchingCards();
			cards[0].isFlipped = true;
			cards[1].isFlipped = true;
			const state = createTestState({
				cards,
			});
			const result = checkMatch(state);
			expect(result?.isMatch).toBe(false);
		});

		it("returns the matched cards", () => {
			const cards = createMatchingCardPair();
			cards[0].isFlipped = true;
			cards[1].isFlipped = true;
			const state = createTestState({
				cards,
			});
			const result = checkMatch(state);
			expect(result?.firstCard.id).toBe("card-0");
			expect(result?.secondCard.id).toBe("card-1");
		});
	});

	describe("applyMatch", () => {
		it("returns unchanged state if not a match", () => {
			const state = createTestState();
			const result = applyMatch(state, {
				isMatch: false,
				firstCard: createTestCard(),
				secondCard: createTestCard({ id: "card-2" }),
			});
			expect(result).toBe(state);
		});

		it("marks cards as matched", () => {
			const cards = createMatchingCardPair();
			const state = createTestState({ cards });
			const result = applyMatch(state, {
				isMatch: true,
				firstCard: cards[0],
				secondCard: cards[1],
			});
			expect(result.cards[0].isMatched).toBe(true);
			expect(result.cards[1].isMatched).toBe(true);
		});

		it("increments current player score", () => {
			const cards = createMatchingCardPair();
			const state = createTestState({ cards, currentPlayer: 1 });
			const result = applyMatch(state, {
				isMatch: true,
				firstCard: cards[0],
				secondCard: cards[1],
			});
			expect(getPlayerScore(result.cards, 1)).toBe(1);
		});

		it("clears selected cards (cards are matched, no longer just flipped)", () => {
			const cards = createMatchingCardPair();
			cards[0].isFlipped = true;
			cards[1].isFlipped = true;
			const state = createTestState({
				cards,
			});
			const result = applyMatch(state, {
				isMatch: true,
				firstCard: cards[0],
				secondCard: cards[1],
			});
			// After match, cards are matched not just flipped, so selected cards is empty
			expect(getSelectedCardIds(result.cards)).toEqual([]);
		});

		it("sets matchedByPlayerId on matched cards", () => {
			const cards = createMatchingCardPair();
			const state = createTestState({ cards, currentPlayer: 2 });
			const result = applyMatch(state, {
				isMatch: true,
				firstCard: cards[0],
				secondCard: cards[1],
			});
			expect(result.cards[0].matchedByPlayerId).toBe(2);
			expect(result.cards[1].matchedByPlayerId).toBe(2);
		});
	});
});

// ============================================
// No-Match Reset Tests
// ============================================

describe("No-Match Reset", () => {
	describe("applyNoMatchWithReset", () => {
		it("flips cards back", () => {
			const cards = createNonMatchingCards().map((c) => ({
				...c,
				isFlipped: true,
			}));
			const state = createTestState({ cards });
			const result = applyNoMatchWithReset(state, ["card-0", "card-1"]);
			expect(result.cards[0].isFlipped).toBe(false);
			expect(result.cards[1].isFlipped).toBe(false);
		});

		it("switches to next player", () => {
			const cards = createNonMatchingCards();
			const state = createTestState({ cards, currentPlayer: 1 });
			const result = applyNoMatchWithReset(state, ["card-0", "card-1"]);
			expect(result.currentPlayer).toBe(2);
		});

		it("clears selected cards (cards are flipped back)", () => {
			const cards = createNonMatchingCards();
			cards[0].isFlipped = true;
			cards[1].isFlipped = true;
			const state = createTestState({
				cards,
			});
			const result = applyNoMatchWithReset(state, ["card-0", "card-1"]);
			// After reset, cards are flipped back so no selected cards
			expect(getSelectedCardIds(result.cards)).toEqual([]);
		});
	});
});

// ============================================
// Turn Management Tests
// ============================================

describe("Turn Management", () => {
	describe("getNextPlayer", () => {
		it("returns 2 when current is 1", () => {
			expect(getNextPlayer(1)).toBe(2);
		});

		it("returns 1 when current is 2", () => {
			expect(getNextPlayer(2)).toBe(1);
		});
	});

	describe("switchPlayer", () => {
		it("switches from player 1 to player 2", () => {
			const state = createTestState({ currentPlayer: 1 });
			const result = switchPlayer(state);
			expect(result.currentPlayer).toBe(2);
		});

		it("switches from player 2 to player 1", () => {
			const state = createTestState({ currentPlayer: 2 });
			const result = switchPlayer(state);
			expect(result.currentPlayer).toBe(1);
		});

		it("does not modify card state (just switches player)", () => {
			const state = createTestState({
				cards: [createTestCard({ id: "card-1", isFlipped: true })],
			});
			const result = switchPlayer(state);
			// switchPlayer only changes currentPlayer, doesn't affect cards
			// Use endTurn to flip cards back and switch player together
			expect(result.cards[0].isFlipped).toBe(true);
		});
	});

	describe("endTurn", () => {
		it("flips all non-matched cards back", () => {
			const cards = [
				createTestCard({ id: "card-0", isFlipped: true }),
				createTestCard({ id: "card-1", isFlipped: true }),
				createTestCard({ id: "card-2", isMatched: true, isFlipped: true }),
			];
			const state = createTestState({ cards });
			const result = endTurn(state);
			expect(result.cards[0].isFlipped).toBe(false);
			expect(result.cards[1].isFlipped).toBe(false);
			expect(result.cards[2].isFlipped).toBe(true); // Matched card stays flipped
		});

		it("switches player", () => {
			const state = createTestState({ currentPlayer: 1 });
			const result = endTurn(state);
			expect(result.currentPlayer).toBe(2);
		});

		it("clears selected cards (by flipping cards back)", () => {
			const state = createTestState({
				cards: [
					createTestCard({ id: "card-1", isFlipped: true }),
					createTestCard({ id: "card-2", isFlipped: true }),
				],
			});
			const result = endTurn(state);
			// endTurn flips cards back, so no selected cards
			expect(getSelectedCardIds(result.cards)).toEqual([]);
		});
	});
});

// ============================================
// Game Status Tests
// ============================================

describe("Game Status", () => {
	describe("isGameOver", () => {
		it("returns false if no cards", () => {
			const state = createTestState({ cards: [] });
			expect(isGameOver(state)).toBe(false);
		});

		it("returns false if not all cards matched", () => {
			const cards = [
				createTestCard({ isMatched: true }),
				createTestCard({ isMatched: false }),
			];
			const state = createTestState({ cards });
			expect(isGameOver(state)).toBe(false);
		});

		it("returns true if all cards matched", () => {
			const cards = [
				createTestCard({ isMatched: true }),
				createTestCard({ isMatched: true }),
			];
			const state = createTestState({ cards });
			expect(isGameOver(state)).toBe(true);
		});
	});

	describe("calculateWinner", () => {
		it("returns null winner with empty players", () => {
			const cards: Card[] = [];
			const players: Player[] = [];
			const result = calculateWinner(cards, players);
			expect(result.winner).toBeNull();
		});

		it("returns player with highest score as winner", () => {
			const players = getTestPlayers();
			// Create cards with matchedByPlayerId to set scores
			const cards = [
				...Array.from({ length: 6 }, (_, i) =>
					createTestCard({
						id: `card-${i}`,
						imageId: `img-${Math.floor(i / 2)}`,
						isMatched: true,
						matchedByPlayerId: 1,
					}),
				),
				...Array.from({ length: 10 }, (_, i) =>
					createTestCard({
						id: `card-${i + 6}`,
						imageId: `img-${Math.floor(i / 2) + 3}`,
						isMatched: true,
						matchedByPlayerId: 2,
					}),
				),
			];
			const result = calculateWinner(cards, players);
			expect(result.winner?.id).toBe(2);
			expect(result.isTie).toBe(false);
		});

		it("detects tie correctly", () => {
			const players = getTestPlayers();
			// Create cards with matchedByPlayerId to set equal scores
			const cards = [
				...Array.from({ length: 6 }, (_, i) =>
					createTestCard({
						id: `card-${i}`,
						imageId: `img-${Math.floor(i / 2)}`,
						isMatched: true,
						matchedByPlayerId: 1,
					}),
				),
				...Array.from({ length: 6 }, (_, i) =>
					createTestCard({
						id: `card-${i + 6}`,
						imageId: `img-${Math.floor(i / 2) + 3}`,
						isMatched: true,
						matchedByPlayerId: 2,
					}),
				),
			];
			const result = calculateWinner(cards, players);
			expect(result.winner).toBeNull();
			expect(result.isTie).toBe(true);
		});
	});

	describe("finishGame", () => {
		it("sets gameStatus to finished", () => {
			const state = createTestState();
			const result = finishGame(state);
			expect(result.gameStatus).toBe("finished");
		});

		it("preserves cards and allows winner to be derived", () => {
			const players = getTestPlayers();
			// Create cards with matchedByPlayerId to set scores
			const cards = [
				...Array.from({ length: 10 }, (_, i) =>
					createTestCard({
						id: `card-${i}`,
						imageId: `img-${Math.floor(i / 2)}`,
						isMatched: true,
						matchedByPlayerId: 1,
					}),
				),
				...Array.from({ length: 6 }, (_, i) =>
					createTestCard({
						id: `card-${i + 10}`,
						imageId: `img-${Math.floor(i / 2) + 5}`,
						isMatched: true,
						matchedByPlayerId: 2,
					}),
				),
			];
			const state = createTestState({ cards });
			const result = finishGame(state);
			expect(result.gameStatus).toBe("finished");
			// Winner is now derived from cards and players, not stored in state
			const { winner } = calculateWinner(result.cards, players);
			expect(winner?.id).toBe(1);
		});

		it("does not modify card state (just sets gameStatus)", () => {
			const state = createTestState({
				cards: [createTestCard({ id: "card-1", isFlipped: true })],
			});
			const result = finishGame(state);
			// finishGame only sets gameStatus - doesn't modify cards
			expect(result.cards[0].isFlipped).toBe(true);
			expect(result.gameStatus).toBe("finished");
		});
	});

	describe("checkAndFinishGame", () => {
		it("returns unchanged if not all matched", () => {
			const cards = [createTestCard({ isMatched: false })];
			const state = createTestState({ cards });
			const result = checkAndFinishGame(state);
			expect(result.gameStatus).toBe("playing");
		});

		it("finishes game if all matched", () => {
			const cards = [
				createTestCard({ isMatched: true }),
				createTestCard({ isMatched: true }),
			];
			const state = createTestState({ cards });
			const result = checkAndFinishGame(state);
			expect(result.gameStatus).toBe("finished");
		});
	});
});

// ============================================
// Game Reset Tests
// ============================================

describe("Game Reset", () => {
	describe("createInitialState", () => {
		it("creates state with setup status", () => {
			const state = createInitialState();
			expect(state.gameStatus).toBe("setup");
		});

		it("sets first player to 1 by default", () => {
			const state = createInitialState();
			expect(state.currentPlayer).toBe(1);
		});

		it("sets first player correctly", () => {
			const state = createInitialState(2);
			expect(state.currentPlayer).toBe(2);
		});

		it("initializes with empty cards", () => {
			const state = createInitialState();
			expect(state.cards).toEqual([]);
		});
	});

	describe("getPlayersFromSettings", () => {
		it("creates two players from settings", () => {
			const players = getPlayersFromSettings({
				player1Name: "Alice",
				player1Color: "#ff0000",
				player2Name: "Bob",
				player2Color: "#00ff00",
			});
			expect(players).toHaveLength(2);
			expect(players[0].name).toBe("Alice");
			expect(players[0].color).toBe("#ff0000");
			expect(players[1].name).toBe("Bob");
			expect(players[1].color).toBe("#00ff00");
		});

		it("assigns correct player IDs", () => {
			const players = getPlayersFromSettings({
				player1Name: "P1",
				player1Color: "#fff",
				player2Name: "P2",
				player2Color: "#000",
			});
			expect(players[0].id).toBe(1);
			expect(players[1].id).toBe(2);
		});
	});

	describe("resetGameState", () => {
		it("preserves currentPlayer", () => {
			const state = createTestState({ currentPlayer: 2 });
			const result = resetGameState(state);
			expect(result.currentPlayer).toBe(2);
		});

		it("clears cards (scores are derived from cards)", () => {
			const state = createTestState({
				cards: [createTestCard({ matchedByPlayerId: 1 })],
			});
			const result = resetGameState(state);
			expect(result.cards).toEqual([]);
			// Scores derived from empty cards would be 0
			const players = getTestPlayers();
			players.forEach((p) => {
				expect(getPlayerScore(result.cards, p.id)).toBe(0);
			});
		});

		it("clears cards", () => {
			const state = createTestState({
				cards: [createTestCard()],
			});
			const result = resetGameState(state);
			expect(result.cards).toEqual([]);
		});

		it("sets status to setup", () => {
			const state = createTestState({ gameStatus: "finished" });
			const result = resetGameState(state);
			expect(result.gameStatus).toBe("setup");
		});
	});

	describe("startGameWithCards", () => {
		it("sets cards on state", () => {
			const cards = [createTestCard()];
			const state = createTestState({ gameStatus: "setup" });
			const result = startGameWithCards(state, cards);
			expect(result.cards).toEqual(cards);
		});

		it("sets status to playing", () => {
			const state = createTestState({ gameStatus: "setup" });
			const result = startGameWithCards(state, []);
			expect(result.gameStatus).toBe("playing");
		});
	});
});

// Note: updatePlayerName and updatePlayerColor tests removed
// Player names and colors are now managed in settings/presence, not GameState

// ============================================
// State Serialization Tests
// ============================================

describe("State Serialization", () => {
	describe("validateState", () => {
		it("returns false for null", () => {
			expect(validateState(null)).toBe(false);
		});

		it("returns false for non-object", () => {
			expect(validateState("string")).toBe(false);
		});

		it("returns false for missing cards array", () => {
			expect(validateState({ players: [], currentPlayer: 1 })).toBe(false);
		});

		it("returns false for invalid gameStatus", () => {
			const state = {
				cards: [],
				players: [],
				currentPlayer: 1,
				gameStatus: "invalid",
			};
			expect(validateState(state)).toBe(false);
		});

		it("returns true for valid state", () => {
			const state = createTestState();
			expect(validateState(state)).toBe(true);
		});
	});
});
