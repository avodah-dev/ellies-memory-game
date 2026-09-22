/**
 * Firebase Mock for Testing
 *
 * Provides mock implementations of FirestoreSyncAdapter and PresenceService
 * for testing online multiplayer functionality without actual Firebase connections.
 */

import { vi } from "vitest";
import type {
	CardPack,
	GameState,
	OnlineGameState,
	Room,
	RoomConfig,
} from "../../types";
import { createTestOnlineGameState, createTestRoom } from "../testUtils";

// ============================================
// Mock Firestore Sync Adapter
// ============================================

export interface MockFirestoreSyncAdapterState {
	connected: boolean;
	odahId: string | null;
	roomCode: string | null;
	isHost: boolean;
	room: Room | null;
	gameState: OnlineGameState | null;
	stateCallbacks: ((state: GameState) => void)[];
	roomCallbacks: ((room: Room | null) => void)[];
}

export function createMockFirestoreSyncAdapter(
	initialState: Partial<MockFirestoreSyncAdapterState> = {},
) {
	const state: MockFirestoreSyncAdapterState = {
		connected: false,
		odahId: null,
		roomCode: null,
		isHost: false,
		room: null,
		gameState: null,
		stateCallbacks: [],
		roomCallbacks: [],
		...initialState,
	};

	const adapter = {
		// State access for tests
		_state: state,

		// Connection
		connect: vi.fn(async () => {
			state.connected = true;
			state.odahId = `mock-odah-${Date.now()}`;
		}),

		disconnect: vi.fn(async () => {
			state.connected = false;
			state.odahId = null;
			state.roomCode = null;
			state.isHost = false;
			state.room = null;
			state.gameState = null;
			state.stateCallbacks = [];
			state.roomCallbacks = [];
		}),

		isConnected: vi.fn(() => state.connected),
		getOdahId: vi.fn(() => state.odahId),
		getRoomCode: vi.fn(() => state.roomCode),
		getIsHost: vi.fn(() => state.isHost),

		// Room operations
		createRoom: vi.fn(
			async (options: {
				hostId: string;
				hostName: string;
				hostColor: string;
				cardPack: CardPack;
				background: string;
				cardBack: string;
				pairCount: number;
			}) => {
				const roomCode = "MOCK";
				state.roomCode = roomCode;
				state.isHost = true;
				state.room = createTestRoom({
					roomCode,
					hostId: options.hostId,
					playerSlots: { [options.hostId]: 1 },
					config: {
						cardPack: options.cardPack,
						background: options.background,
						cardBack: options.cardBack,
						pairCount: options.pairCount,
					},
				});
				return roomCode;
			},
		),

		joinRoom: vi.fn(
			async (
				roomCode: string,
				options: {
					odahId: string;
					name: string;
					color: string;
				},
			) => {
				state.roomCode = roomCode.toUpperCase();
				state.isHost = false;
				if (!state.room) {
					state.room = createTestRoom({ roomCode: roomCode.toUpperCase() });
				}
				state.room.playerSlots![options.odahId] = 2;
				return state.room;
			},
		),

		leaveRoom: vi.fn(async () => {
			state.roomCode = null;
			state.isHost = false;
			state.room = null;
		}),

		getRoom: vi.fn(async (roomCode: string) => {
			if (state.room?.roomCode === roomCode.toUpperCase()) {
				return state.room;
			}
			return null;
		}),

		subscribeToRoom: vi.fn(
			(_roomCode: string, callback: (room: Room | null) => void) => {
				state.roomCallbacks.push(callback);
				// Immediately call with current room
				if (state.room) {
					callback(state.room);
				}
				return () => {
					const index = state.roomCallbacks.indexOf(callback);
					if (index > -1) {
						state.roomCallbacks.splice(index, 1);
					}
				};
			},
		),

		updateRoomConfig: vi.fn(
			async (_roomCode: string, config: Partial<RoomConfig>) => {
				if (state.room?.config) {
					state.room.config = { ...state.room.config, ...config };
					state.roomCallbacks.forEach((cb) => cb(state.room));
				}
			},
		),

		resetRoomToWaiting: vi.fn(async (_roomCode: string) => {
			if (state.room) {
				state.room.status = "waiting";
				state.roomCallbacks.forEach((cb) => cb(state.room));
			}
		}),

		startGame: vi.fn(async (_roomCode: string, initialState: GameState) => {
			if (!state.room) throw new Error("Not in a room");
			state.room.status = "playing";
			state.gameState = createTestOnlineGameState({
				...initialState,
				syncVersion: 1,
				gameRound: (state.gameState?.gameRound ?? 0) + 1,
			});
			state.roomCallbacks.forEach((cb) => cb(state.room));
			state.stateCallbacks.forEach((cb) => cb(state.gameState!));
			return state.gameState;
		}),

		// Game state operations
		getState: vi.fn(async () => state.gameState),

		setState: vi.fn(async (newState: GameState) => {
			state.gameState = {
				...newState,
				syncVersion: (state.gameState?.syncVersion || 0) + 1,
				gameRound: state.gameState?.gameRound || 1,
			};
			state.stateCallbacks.forEach((cb) => cb(state.gameState!));
		}),

		subscribeToState: vi.fn((callback: (state: GameState) => void) => {
			state.stateCallbacks.push(callback);
			if (state.gameState) {
				callback(state.gameState);
			}
			return () => {
				const index = state.stateCallbacks.indexOf(callback);
				if (index > -1) {
					state.stateCallbacks.splice(index, 1);
				}
			};
		}),

		// Player operations
		updatePlayerName: vi.fn(async (_name: string) => {}),
		updatePlayerColor: vi.fn(async (_color: string) => {}),

		// Test helpers
		_simulateRoomUpdate: (room: Room | null) => {
			state.room = room;
			state.roomCallbacks.forEach((cb) => cb(room));
		},

		_simulateStateUpdate: (gameState: OnlineGameState) => {
			state.gameState = gameState;
			state.stateCallbacks.forEach((cb) => cb(gameState));
		},

		_reset: () => {
			state.connected = false;
			state.odahId = null;
			state.roomCode = null;
			state.isHost = false;
			state.room = null;
			state.gameState = null;
			state.stateCallbacks = [];
			state.roomCallbacks = [];
			vi.clearAllMocks();
		},
	};

	return adapter;
}

// ============================================
// Mock Presence Service
// ============================================

export interface MockPresenceState {
	roomCode: string;
	odahId: string;
	name: string;
	color: string;
	slot: 1 | 2;
	started: boolean;
}

export function createMockPresenceService(
	roomCode: string,
	odahId: string,
	name: string,
	color: string,
	slot: 1 | 2,
) {
	const state: MockPresenceState = {
		roomCode,
		odahId,
		name,
		color,
		slot,
		started: false,
	};

	return {
		_state: state,

		start: vi.fn(async () => {
			state.started = true;
		}),

		stop: vi.fn(async () => {
			state.started = false;
		}),

		updateName: vi.fn(async (newName: string) => {
			state.name = newName;
		}),

		updateColor: vi.fn(async (newColor: string) => {
			state.color = newColor;
		}),
	};
}

// ============================================
// Module Mock Setup
// ============================================

let mockAdapter: ReturnType<typeof createMockFirestoreSyncAdapter> | null =
	null;

/**
 * Setup Firebase mocks for testing.
 * Call this in beforeEach() to get a fresh mock adapter.
 */
export function setupFirebaseMocks() {
	mockAdapter = createMockFirestoreSyncAdapter();
	return mockAdapter;
}

/**
 * Get the current mock adapter.
 * Creates one automatically if not already setup (for hoisted vi.mock calls).
 */
export function getMockFirestoreSyncAdapter() {
	if (!mockAdapter) {
		// Auto-create if called before setup (e.g., from hoisted vi.mock)
		mockAdapter = createMockFirestoreSyncAdapter();
	}
	return mockAdapter;
}

/**
 * Reset Firebase mocks.
 * Call this in afterEach() to clean up.
 */
export function resetFirebaseMocks() {
	if (mockAdapter) {
		mockAdapter._reset();
	}
	mockAdapter = null;
}

/**
 * Create Vitest mock modules for Firebase.
 * Use with vi.mock() in test files.
 *
 * @example
 * ```ts
 * vi.mock("../../services/sync/FirestoreSyncAdapter", () => createFirestoreSyncAdapterMock());
 * ```
 */
export function createFirestoreSyncAdapterMock() {
	return {
		getFirestoreSyncAdapter: () => getMockFirestoreSyncAdapter(),
		resetFirestoreSyncAdapter: () => resetFirebaseMocks(),
		FirestoreSyncAdapter: vi.fn(),
	};
}
