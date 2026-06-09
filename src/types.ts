export interface Card {
	id: string;
	imageId: string;
	imageUrl: string;
	gradient?: string;
	isFlipped: boolean;
	isMatched: boolean;
	// isFlyingToPlayer removed - animation is a local UI concern, not synced state
	// flyingToPlayerId removed - animation is a local UI concern, not synced state
	matchedByPlayerId?: number; // Track which player matched this card
}

export interface Player {
	id: number;
	name: string;
	color: string; // Hex color code for the player
	// score removed - derived from cards via getPlayerScore()
}

export type GameStatus = "setup" | "playing" | "finished";

export interface GameState {
	cards: Card[];
	currentPlayer: number;
	// players[] removed - derive via getPlayersFromSettings() or getPlayersFromPresence()
	// selectedCards removed - derive via getSelectedCardIds(cards)
	gameStatus: GameStatus;
	// winner removed - derive via calculateWinner(cards, players)
	// isTie removed - derive via calculateWinner(cards, players)
}

export type CardPack =
	| "animals"
	| "animals-real"
	| "plants"
	| "buildings"
	| "colors"
	| "ocean"
	| "ocean-real"
	| "construction"
	| "construction-real"
	| "emotions-real"
	| "insects-real"
	| "jungle-animals-real"
	| "plush-cute-animals-real"
	| "animals-from-china-real"
	| "thanksgiving"
	| "christmas"
	| "dinos"
	| "hotwheels"
	| "summer-fun";

export interface CardPackOption {
	id: CardPack;
	name: string;
	emoji: string;
}

// ============================================
// Game Theme Types
// ============================================

export interface GameTheme {
	id: string;
	name: string;
	description: string;
	category: "holiday" | "nature" | "kids" | "educational";
	cardPack: CardPack;
	background: string; // BackgroundTheme as string
	cardBack: string; // CardBackType as string
	previewEmoji: string; // For quick visual identification
}

// ============================================
// Online Multiplayer Types
// ============================================

export type GameMode = "local" | "online";

export type ConnectionStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting";

export type RoomStatus = "waiting" | "playing" | "finished";

export interface OnlinePlayer extends Player {
	odahId: string; // Firebase anonymous auth UID
	isHost: boolean;
	isConnected: boolean;
	lastSeen: number; // Timestamp
}

export interface RoomConfig {
	roomCode: string;
	hostId: string;
	status: RoomStatus;
	cardPack: CardPack;
	background: string;
	cardBack: string;
	pairCount?: number; // Number of pairs (4-20), defaults to 20 if not set
	createdAt: number;
	lastActivity: number;
}

export interface OnlineGameState extends GameState {
	syncVersion: number; // For optimistic concurrency control
	lastUpdatedBy?: number; // Player slot (1 or 2) who made the last update - used to skip self-updates
	gameRound: number; // Increments each time a new game starts - used to detect resets
}

export interface Room {
	roomCode: string;
	hostId: string;
	status: RoomStatus;
	config: {
		cardPack: CardPack;
		background: string;
		cardBack: string;
		pairCount?: number; // Number of pairs (4-20), defaults to 20 if not set
	} | null;
	// playerSlots: just stores slot assignment (1 or 2) per odahId
	// Name/color come from RTDB presence only (single source of truth)
	playerSlots?: Record<string, 1 | 2>;
	// Legacy: old rooms may have full player objects - handle in joinRoom for backwards compat
	players?: Record<string, { slot: 1 | 2; name: string; color: string }>;
	createdAt: number;
	lastActivity: number;
}

// RTDB Presence
export interface PresenceData {
	odahId: string;
	name: string;
	color: string;
	slot: 1 | 2;
	online: boolean;
	lastSeen: number;
}

// Cursor Position (grid-relative coordinates)
export interface CursorPosition {
	x: number; // Grid column position (0-8, where 3.5 means column 3, 50% across the card)
	y: number; // Grid row position (0-5, where 2.25 means row 2, 25% down the card)
	timestamp: number; // Timestamp when position was recorded
}
