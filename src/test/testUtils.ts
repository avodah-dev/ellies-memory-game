/**
 * Test Utilities and Fixtures
 *
 * Shared fixtures and helpers for testing.
 * Extends patterns from GameEngine.test.ts.
 */

import type { GameSettings } from "../stores/settingsStore";
import type { LayoutMetrics } from "../stores/uiStore";
import type {
	Card,
	GameState,
	OnlineGameState,
	Player,
	PresenceData,
	Room,
} from "../types";

// ============================================
// Card Fixtures
// ============================================

export function createTestCard(overrides: Partial<Card> = {}): Card {
	return {
		id: "card-1",
		imageId: "img-1",
		imageUrl: "/test.png",
		isFlipped: false,
		isMatched: false,
		...overrides,
	};
}

export function createMatchingCardPair(
	imageId: string = "img-1",
	baseId: number = 0,
): Card[] {
	return [
		createTestCard({ id: `card-${baseId}`, imageId }),
		createTestCard({ id: `card-${baseId + 1}`, imageId }),
	];
}

export function createNonMatchingCards(): Card[] {
	return [
		createTestCard({ id: "card-0", imageId: "img-1" }),
		createTestCard({ id: "card-1", imageId: "img-2" }),
	];
}

export function createCardSet(pairCount: number): Card[] {
	const cards: Card[] = [];
	for (let i = 0; i < pairCount; i++) {
		cards.push(...createMatchingCardPair(`img-${i}`, i * 2));
	}
	return cards;
}

// ============================================
// Player Fixtures
// ============================================

export function createTestPlayer(overrides: Partial<Player> = {}): Player {
	return {
		id: 1,
		name: "Player 1",
		color: "#3b82f6",
		...overrides,
	};
}

export function getTestPlayers(): Player[] {
	return [
		createTestPlayer({ id: 1, name: "Player 1", color: "#3b82f6" }),
		createTestPlayer({ id: 2, name: "Player 2", color: "#10b981" }),
	];
}

// ============================================
// Game State Fixtures
// ============================================

export function createTestGameState(
	overrides: Partial<GameState> = {},
): GameState {
	return {
		cards: [],
		currentPlayer: 1,
		gameStatus: "playing",
		...overrides,
	};
}

export function createPlayingGameState(pairCount: number = 6): GameState {
	return createTestGameState({
		cards: createCardSet(pairCount),
		gameStatus: "playing",
	});
}

export function createFinishedGameState(): GameState {
	const cards = createCardSet(6);
	// Mark all cards as matched
	const matchedCards = cards.map((card, index) => ({
		...card,
		isMatched: true,
		matchedByPlayerId: index % 4 < 2 ? 1 : 2, // Alternate between players
	}));

	return createTestGameState({
		cards: matchedCards,
		gameStatus: "finished",
	});
}

// ============================================
// Online Game State Fixtures
// ============================================

export function createTestOnlineGameState(
	overrides: Partial<OnlineGameState> = {},
): OnlineGameState {
	return {
		cards: [],
		currentPlayer: 1,
		gameStatus: "playing",
		syncVersion: 1,
		gameRound: 1,
		lastUpdatedBy: 1,
		...overrides,
	};
}

// ============================================
// Settings Fixtures
// ============================================

export function createTestSettings(
	overrides: Partial<GameSettings> = {},
): GameSettings {
	return {
		player1Name: "Player 1",
		player1Color: "#3b82f6",
		player2Name: "Player 2",
		player2Color: "#10b981",
		firstPlayer: 1,
		savedPlayerNames: [],
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
		...overrides,
	};
}

// ============================================
// Layout Metrics Fixtures
// ============================================

export function createTestLayoutMetrics(
	overrides: Partial<LayoutMetrics> = {},
): LayoutMetrics {
	return {
		boardWidth: 800,
		boardAvailableHeight: 600,
		scoreboardHeight: 80,
		...overrides,
	};
}

// ============================================
// Room Fixtures
// ============================================

export function createTestRoom(overrides: Partial<Room> = {}): Room {
	return {
		roomCode: "ABCD",
		hostId: "host-odah-id",
		status: "waiting",
		config: {
			cardPack: "animals",
			background: "default",
			cardBack: "default",
			pairCount: 20,
		},
		playerSlots: {
			"host-odah-id": 1,
		},
		createdAt: Date.now(),
		lastActivity: Date.now(),
		...overrides,
	};
}

export function createPlayingRoom(overrides: Partial<Room> = {}): Room {
	return createTestRoom({
		status: "playing",
		playerSlots: {
			"host-odah-id": 1,
			"guest-odah-id": 2,
		},
		...overrides,
	});
}

// ============================================
// Presence Fixtures
// ============================================

export function createTestPresenceData(
	overrides: Partial<PresenceData> = {},
): PresenceData {
	return {
		odahId: "test-odah-id",
		name: "Test Player",
		color: "#3b82f6",
		slot: 1,
		online: true,
		lastSeen: Date.now(),
		...overrides,
	};
}

export function createHostPresence(
	overrides: Partial<PresenceData> = {},
): PresenceData {
	return createTestPresenceData({
		odahId: "host-odah-id",
		name: "Host",
		color: "#3b82f6",
		slot: 1,
		...overrides,
	});
}

export function createGuestPresence(
	overrides: Partial<PresenceData> = {},
): PresenceData {
	return createTestPresenceData({
		odahId: "guest-odah-id",
		name: "Guest",
		color: "#10b981",
		slot: 2,
		...overrides,
	});
}

export function createFullPresenceData(): Record<string, PresenceData> {
	return {
		"host-odah-id": createHostPresence(),
		"guest-odah-id": createGuestPresence(),
	};
}

// ============================================
// Store Reset Utilities
// ============================================

/**
 * Reset all Zustand stores to their initial state.
 * Call this in beforeEach() to ensure clean state between tests.
 */
export async function resetAllStores(): Promise<void> {
	// Import stores dynamically to avoid circular dependencies
	const { useSettingsStore } = await import("../stores/settingsStore");
	const { useUIStore } = await import("../stores/uiStore");
	const { useOnlineStore } = await import("../stores/onlineStore");

	// Reset UI store (has explicit reset method)
	useUIStore.getState().resetUIState();

	// Reset online store (has explicit reset method)
	useOnlineStore.getState().reset();

	// Reset settings store to defaults
	// Note: settingsStore uses persist, so we need to clear localStorage too
	const defaultSettings = createTestSettings();
	useSettingsStore.getState().updateSettings(defaultSettings);
}

/**
 * Clear localStorage and sessionStorage for clean test state.
 * Useful for testing persistence behavior.
 */
export function clearStorage(): void {
	if (typeof window !== "undefined") {
		localStorage.clear();
		sessionStorage.clear();
	}
}

// ============================================
// Async Test Utilities
// ============================================

/**
 * Wait for a condition to be true.
 * Useful for testing async state updates.
 */
export async function waitFor(
	condition: () => boolean,
	timeout: number = 1000,
	interval: number = 10,
): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeout) {
			throw new Error("waitFor timeout");
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
}

/**
 * Wait for the next tick of the event loop.
 */
export function nextTick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Flush all pending promises.
 */
export async function flushPromises(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

// ============================================
// Mock Event Utilities
// ============================================

/**
 * Create a mock keyboard event.
 */
export function createKeyboardEvent(
	type: "keydown" | "keyup",
	key: string,
	options: Partial<KeyboardEventInit> = {},
): KeyboardEvent {
	return new KeyboardEvent(type, {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
}

/**
 * Create a mock mouse event.
 */
export function createMouseEvent(
	type: string,
	options: Partial<MouseEventInit> = {},
): MouseEvent {
	return new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX: 0,
		clientY: 0,
		...options,
	});
}

/**
 * Create a mock touch event.
 */
export function createTouchEvent(
	type: string,
	touches: Array<{ clientX: number; clientY: number }>,
): TouchEvent {
	const touchList = touches.map(
		(t, i) =>
			({
				identifier: i,
				target: document.body,
				clientX: t.clientX,
				clientY: t.clientY,
				pageX: t.clientX,
				pageY: t.clientY,
				screenX: t.clientX,
				screenY: t.clientY,
				radiusX: 0,
				radiusY: 0,
				rotationAngle: 0,
				force: 0,
			}) as Touch,
	);

	return new TouchEvent(type, {
		touches: touchList,
		targetTouches: touchList,
		changedTouches: touchList,
		bubbles: true,
		cancelable: true,
	});
}

// ============================================
// Type Guards for Tests
// ============================================

export function isCard(obj: unknown): obj is Card {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"id" in obj &&
		"imageId" in obj &&
		"isFlipped" in obj &&
		"isMatched" in obj
	);
}

export function isPlayer(obj: unknown): obj is Player {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"id" in obj &&
		"name" in obj &&
		"color" in obj
	);
}

export function isGameState(obj: unknown): obj is GameState {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"cards" in obj &&
		"currentPlayer" in obj &&
		"gameStatus" in obj
	);
}
