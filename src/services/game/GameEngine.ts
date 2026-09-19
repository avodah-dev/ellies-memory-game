/**
 * GameEngine - Pure functions for memory game logic
 *
 * All functions are pure: they take state and return new state without side effects.
 * This makes the game logic testable, replayable, and easy to sync across network.
 */

import type { Card, GameState, Player } from "../../types";

// ============================================
// Helper Functions
// ============================================

/**
 * Sort players by ID (ensures consistent ordering)
 */
export function sortPlayersByID(players: Player[]): Player[] {
	return [...players].sort((a, b) => a.id - b.id);
}

/**
 * Get player by ID
 */
export function getPlayerById(
	players: Player[],
	id: number,
): Player | undefined {
	return players.find((p) => p.id === id);
}

/**
 * Calculate player score from cards (single source of truth)
 * Score = number of cards matched by this player / 2 (since cards come in pairs)
 */
export function getPlayerScore(cards: Card[], playerId: number): number {
	return cards.filter((c) => c.matchedByPlayerId === playerId).length / 2;
}

/**
 * Get currently selected cards (flipped but not yet matched)
 * This is the derived replacement for GameState.selectedCards
 */
export function getSelectedCards(cards: Card[]): Card[] {
	return cards.filter((c) => c.isFlipped && !c.isMatched);
}

/**
 * Get IDs of currently selected cards
 */
export function getSelectedCardIds(cards: Card[]): string[] {
	return getSelectedCards(cards).map((c) => c.id);
}

/**
 * Generate a 4-character room code (uppercase letters, excluding ambiguous chars)
 */
export function generateRoomCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // Excludes O and I
	return Array.from(
		{ length: 4 },
		() => chars[Math.floor(Math.random() * chars.length)],
	).join("");
}

// ============================================
// Player Info Helpers (derived from settings or presence)
// ============================================

/**
 * Settings structure for extracting player info (local mode)
 */
export interface PlayerSettings {
	player1Name: string;
	player1Color: string;
	player2Name: string;
	player2Color: string;
}

/**
 * Presence data structure for extracting player info (online mode)
 */
export interface PresencePlayer {
	name: string;
	color: string;
	slot: 1 | 2;
}

/**
 * Get players array from settings (for local mode)
 */
export function getPlayersFromSettings(settings: PlayerSettings): Player[] {
	return [
		{ id: 1, name: settings.player1Name, color: settings.player1Color },
		{ id: 2, name: settings.player2Name, color: settings.player2Color },
	];
}

/**
 * Get players array from presence data (for online mode)
 */
export function getPlayersFromPresence(
	presenceData: Record<string, PresencePlayer>,
): Player[] {
	const players: Player[] = [];
	for (const presence of Object.values(presenceData)) {
		players.push({
			id: presence.slot,
			name: presence.name,
			color: presence.color,
		});
	}
	return sortPlayersByID(players);
}

// ============================================
// Card Initialization
// ============================================

export interface CardImage {
	id: string;
	url: string;
	gradient?: string;
}

/**
 * Create pairs of cards from images
 */
export function createCardPairs(images: CardImage[]): Card[] {
	const cards: Card[] = [];

	images.forEach((image, index) => {
		// Create two cards for each image (a matching pair)
		cards.push({
			id: `card-${index * 2}`,
			imageId: image.id,
			imageUrl: image.url,
			gradient: image.gradient,
			isFlipped: false,
			isMatched: false,
		});
		cards.push({
			id: `card-${index * 2 + 1}`,
			imageId: image.id,
			imageUrl: image.url,
			gradient: image.gradient,
			isFlipped: false,
			isMatched: false,
		});
	});

	return cards;
}

/**
 * Shuffle an array using Fisher-Yates algorithm
 */
export function shuffleCards<T>(
	cards: T[],
	random: () => number = Math.random,
): T[] {
	const shuffled = [...cards];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
}

/**
 * Initialize cards from images (create pairs and shuffle)
 */
export function initializeCards(
	images: CardImage[],
	random: () => number = Math.random,
): Card[] {
	const pairs = createCardPairs(images);
	return shuffleCards(pairs, random);
}

// ============================================
// Card Operations
// ============================================

/**
 * Check if a card can be flipped
 */
export function canFlipCard(state: GameState, cardId: string): boolean {
	if (state.gameStatus !== "playing") {
		return false;
	}

	// Already have 2 cards selected (derived from cards)
	const selectedCards = getSelectedCards(state.cards);
	if (selectedCards.length >= 2) {
		return false;
	}

	const card = state.cards.find((c) => c.id === cardId);
	if (!card) {
		return false;
	}

	// Can't flip already flipped or matched cards
	if (card.isFlipped || card.isMatched) {
		return false;
	}

	return true;
}

/**
 * Flip a card (pure function - returns new state)
 * Note: selectedCards is now derived from cards, so we just set isFlipped: true
 */
export function flipCard(state: GameState, cardId: string): GameState {
	if (!canFlipCard(state, cardId)) {
		return state;
	}

	const newCards = state.cards.map((c) =>
		c.id === cardId ? { ...c, isFlipped: true } : c,
	);

	return {
		...state,
		cards: newCards,
	};
}

// ============================================
// Match Detection
// ============================================

export interface MatchResult {
	isMatch: boolean;
	firstCard: Card;
	secondCard: Card;
}

/**
 * Check if two selected cards are a match
 * Uses derived selectedCards from card state
 */
export function checkMatch(state: GameState): MatchResult | null {
	const selectedCards = getSelectedCards(state.cards);
	if (selectedCards.length !== 2) {
		return null;
	}

	const [firstCard, secondCard] = selectedCards;

	return {
		isMatch: firstCard.imageId === secondCard.imageId,
		firstCard,
		secondCard,
	};
}

/**
 * Apply match result to state (marks cards as matched, updates score)
 * Note: This is the direct version that skips animation. For animated matches,
 * use startMatchAnimation() followed by completeMatchAnimation().
 */
export function applyMatch(
	state: GameState,
	matchResult: MatchResult,
): GameState {
	if (!matchResult.isMatch) {
		return state;
	}

	const { firstCard, secondCard } = matchResult;
	const currentPlayerId = state.currentPlayer;

	// Mark cards as matched
	const newCards = state.cards.map((c) =>
		c.id === firstCard.id || c.id === secondCard.id
			? {
					...c,
					isMatched: true,
					isFlipped: true,
					matchedByPlayerId: currentPlayerId,
				}
			: c,
	);

	// Score is now derived from cards - no need to update player.score

	return {
		...state,
		cards: newCards,
	};
}

// startMatchAnimation and completeMatchAnimation removed
// Animation is now handled locally in GameBoard.tsx
// Use applyMatch() directly for match handling

/**
 * Apply no-match result with card reset (flips cards back, switches player)
 */
export function applyNoMatchWithReset(
	state: GameState,
	cardIds: [string, string],
): GameState {
	const [firstId, secondId] = cardIds;

	// Flip cards back
	const newCards = state.cards.map((c) =>
		c.id === firstId || c.id === secondId ? { ...c, isFlipped: false } : c,
	);

	// Switch to next player
	const nextPlayer = getNextPlayer(state.currentPlayer);

	return {
		...state,
		cards: newCards,
		currentPlayer: nextPlayer,
	};
}

// ============================================
// Turn Management
// ============================================

/**
 * Get the next player ID
 */
export function getNextPlayer(currentPlayer: number): number {
	return currentPlayer === 1 ? 2 : 1;
}

/**
 * Switch to the next player
 */
export function switchPlayer(state: GameState): GameState {
	return {
		...state,
		currentPlayer: getNextPlayer(state.currentPlayer),
	};
}

/**
 * End turn manually (flip all non-matched cards back, switch player)
 */
export function endTurn(state: GameState): GameState {
	// Flip all non-matched cards back
	const newCards = state.cards.map((c) => {
		if (c.isMatched) {
			return c;
		}
		if (c.isFlipped) {
			return { ...c, isFlipped: false };
		}
		return c;
	});

	return {
		...state,
		cards: newCards,
		currentPlayer: getNextPlayer(state.currentPlayer),
	};
}

// ============================================
// Game Status
// ============================================

/**
 * Check if the game is over (all cards matched)
 */
export function isGameOver(state: GameState): boolean {
	if (state.cards.length === 0) {
		return false;
	}
	return state.cards.every((c) => c.isMatched);
}

/**
 * Calculate the winner from cards and players
 * Players are passed in because they're no longer stored in GameState
 */
export function calculateWinner(
	cards: Card[],
	players: Player[],
): {
	winner: Player | null;
	isTie: boolean;
} {
	if (players.length === 0) {
		return { winner: null, isTie: false };
	}

	// Find player with highest score (derived from cards)
	const winner = players.reduce((prev, current) => {
		const prevScore = getPlayerScore(cards, prev.id);
		const currentScore = getPlayerScore(cards, current.id);
		return currentScore > prevScore ? current : prev;
	});

	// Check if it's a tie
	const winnerScore = getPlayerScore(cards, winner.id);
	const isTie = players.every(
		(p) => getPlayerScore(cards, p.id) === winnerScore,
	);

	return {
		winner: isTie ? null : winner,
		isTie,
	};
}

/**
 * Finish the game (set status to finished)
 * Winner/isTie are now derived via calculateWinner(cards, players)
 */
export function finishGame(state: GameState): GameState {
	return {
		...state,
		gameStatus: "finished",
	};
}

/**
 * Check if game should end and apply finish if so
 */
export function checkAndFinishGame(state: GameState): GameState {
	if (isGameOver(state)) {
		return finishGame(state);
	}
	return state;
}

// ============================================
// Game Reset
// ============================================

/**
 * Create initial game state
 * Players are no longer stored in GameState - use getPlayersFromSettings() or getPlayersFromPresence()
 */
export function createInitialState(firstPlayer: 1 | 2 = 1): GameState {
	return {
		cards: [],
		currentPlayer: firstPlayer,
		gameStatus: "setup",
	};
}

/**
 * Reset game state (clear cards, reset status)
 * Player names/colors are stored in settings, not in game state
 */
export function resetGameState(state: GameState): GameState {
	return {
		cards: [],
		currentPlayer: state.currentPlayer, // Keep the current player setting
		gameStatus: "setup",
	};
}

/**
 * Start game with cards
 */
export function startGameWithCards(state: GameState, cards: Card[]): GameState {
	return {
		...state,
		cards,
		gameStatus: "playing",
	};
}

export { isGameState as validateState } from "../sync/stateProtocol";
