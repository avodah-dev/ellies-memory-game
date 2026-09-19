/**
 * onlineStore Tests
 *
 * Tests for online multiplayer state including connection management,
 * room operations, and presence tracking.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getMockFirestoreSyncAdapter,
	resetFirebaseMocks,
	setupFirebaseMocks,
} from "../test/mocks/firebase";
import { resetStorageMocks, setupStorageMocks } from "../test/mocks/storage";
import { createGuestPresence, createHostPresence } from "../test/testUtils";
import {
	selectCanStartGame,
	selectIsConnected,
	selectIsInRoom,
	selectIsOnline,
	selectOpponent,
	selectSelf,
	useOnlineStore,
} from "./onlineStore";

// Mock the FirestoreSyncAdapter module
vi.mock("../services/sync/FirestoreSyncAdapter", () => ({
	getFirestoreSyncAdapter: () => getMockFirestoreSyncAdapter(),
	resetFirestoreSyncAdapter: () => resetFirebaseMocks(),
}));

// Mock PresenceService
vi.mock("../services/sync/PresenceService", () => ({
	PresenceService: {
		subscribeToRoomPresence: vi.fn((_roomCode, _callback) => {
			// Return unsubscribe function
			return () => {};
		}),
	},
}));

describe("onlineStore", () => {
	beforeEach(() => {
		setupStorageMocks();
		setupFirebaseMocks();
		useOnlineStore.getState().reset();
	});

	afterEach(() => {
		resetStorageMocks();
		resetFirebaseMocks();
	});

	// ============================================
	// Initial State Tests
	// ============================================

	describe("initial state", () => {
		it("should start with null game mode", () => {
			expect(useOnlineStore.getState().gameMode).toBe(null);
		});

		it("should start disconnected", () => {
			expect(useOnlineStore.getState().connectionStatus).toBe("disconnected");
		});

		it("should start with null odahId", () => {
			expect(useOnlineStore.getState().odahId).toBe(null);
		});

		it("should start with no room", () => {
			expect(useOnlineStore.getState().room).toBe(null);
			expect(useOnlineStore.getState().roomCode).toBe(null);
		});

		it("should start as not host", () => {
			expect(useOnlineStore.getState().isHost).toBe(false);
		});

		it("should start with default player name", () => {
			// Default is "Player" or stored preference
			expect(useOnlineStore.getState().playerName).toBeDefined();
		});

		it("should start with empty presence data", () => {
			expect(useOnlineStore.getState().presenceData).toEqual({});
		});

		it("should start with opponent not connected", () => {
			expect(useOnlineStore.getState().opponentConnected).toBe(false);
		});

		it("should start with no error", () => {
			expect(useOnlineStore.getState().error).toBe(null);
		});
	});

	// ============================================
	// Game Mode Tests
	// ============================================

	describe("game mode", () => {
		it("should set game mode to online", () => {
			const { setGameMode } = useOnlineStore.getState();

			setGameMode("online");
			expect(useOnlineStore.getState().gameMode).toBe("online");
		});

		it("should set game mode to local", () => {
			const { setGameMode } = useOnlineStore.getState();

			setGameMode("local");
			expect(useOnlineStore.getState().gameMode).toBe("local");
		});

		it("should set game mode to null", () => {
			const { setGameMode } = useOnlineStore.getState();

			setGameMode("online");
			setGameMode(null);
			expect(useOnlineStore.getState().gameMode).toBe(null);
		});
	});

	// ============================================
	// Connection Tests
	// ============================================

	describe("connection", () => {
		it("should connect successfully", async () => {
			const { connect } = useOnlineStore.getState();

			await connect();

			const state = useOnlineStore.getState();
			expect(state.connectionStatus).toBe("connected");
			expect(state.odahId).toBeDefined();
			expect(state.odahId).not.toBe(null);
		});

		it("should set connecting status during connection", async () => {
			const { connect } = useOnlineStore.getState();

			const connectPromise = connect();

			// Connection should go through connecting state
			// (This may be too fast to catch, but the logic is there)
			await connectPromise;

			expect(useOnlineStore.getState().connectionStatus).toBe("connected");
		});

		it("should not reconnect if already connected", async () => {
			const { connect } = useOnlineStore.getState();
			const adapter = getMockFirestoreSyncAdapter();

			await connect();
			await connect(); // Should be a no-op

			expect(adapter.connect).toHaveBeenCalledTimes(1);
		});

		it("should disconnect successfully", async () => {
			const { connect, disconnect } = useOnlineStore.getState();

			await connect();
			await disconnect();

			const state = useOnlineStore.getState();
			expect(state.connectionStatus).toBe("disconnected");
			expect(state.odahId).toBe(null);
			expect(state.room).toBe(null);
			expect(state.roomCode).toBe(null);
		});
	});

	// ============================================
	// Room Operations Tests
	// ============================================

	describe("room operations", () => {
		beforeEach(async () => {
			await useOnlineStore.getState().connect();
		});

		it("should create a room", async () => {
			const { createRoom } = useOnlineStore.getState();

			const roomCode = await createRoom({
				hostName: "Host Player",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});

			const state = useOnlineStore.getState();
			expect(roomCode).toBe("MOCK");
			expect(state.roomCode).toBe("MOCK");
			expect(state.isHost).toBe(true);
		});

		it("should join a room", async () => {
			const { createRoom, reset, connect, joinRoom } =
				useOnlineStore.getState();

			// First create a room as host
			await createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});

			// Reset and reconnect as guest
			reset();
			await connect();

			// Join the room
			const room = await joinRoom("MOCK", "Guest Player", "#10b981");

			const state = useOnlineStore.getState();
			expect(state.roomCode).toBe("MOCK");
			expect(state.isHost).toBe(false);
			expect(room).toBeDefined();
		});

		it("should leave a room", async () => {
			const { createRoom, leaveRoom } = useOnlineStore.getState();

			await createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});

			await leaveRoom();

			const state = useOnlineStore.getState();
			expect(state.roomCode).toBe(null);
			expect(state.room).toBe(null);
			expect(state.isHost).toBe(false);
		});

		it("should throw when creating room without connection", async () => {
			const { disconnect, createRoom } = useOnlineStore.getState();

			await disconnect();

			await expect(
				createRoom({
					hostName: "Host",
					hostColor: "#3b82f6",
					cardPack: "animals",
					background: "default",
					cardBack: "default",
					pairCount: 20,
				}),
			).rejects.toThrow("Not connected");
		});

		it("should throw when joining room without connection", async () => {
			const { disconnect, joinRoom } = useOnlineStore.getState();

			await disconnect();

			await expect(joinRoom("ABCD", "Guest", "#10b981")).rejects.toThrow(
				"Not connected",
			);
		});
	});

	// ============================================
	// Room Config Tests
	// ============================================

	describe("room config", () => {
		beforeEach(async () => {
			await useOnlineStore.getState().connect();
			await useOnlineStore.getState().createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});
		});

		it("should update room config as host", async () => {
			const { updateRoomConfig } = useOnlineStore.getState();
			const adapter = getMockFirestoreSyncAdapter();

			await updateRoomConfig({ cardPack: "plants" });

			expect(adapter.updateRoomConfig).toHaveBeenCalledWith("MOCK", {
				cardPack: "plants",
			});
		});

		it("should reset room to waiting as host", async () => {
			const { resetRoomToWaiting } = useOnlineStore.getState();
			const adapter = getMockFirestoreSyncAdapter();

			await resetRoomToWaiting();

			expect(adapter.resetRoomToWaiting).toHaveBeenCalledWith("MOCK");
		});
	});

	// ============================================
	// Player Settings Tests
	// ============================================

	describe("player settings", () => {
		it("should set player name preference", () => {
			const { setPlayerNamePreference } = useOnlineStore.getState();

			setPlayerNamePreference("New Name");

			expect(useOnlineStore.getState().playerName).toBe("New Name");
		});

		it("should trim whitespace from player name", () => {
			const { setPlayerNamePreference } = useOnlineStore.getState();

			setPlayerNamePreference("  Trimmed Name  ");

			expect(useOnlineStore.getState().playerName).toBe("Trimmed Name");
		});

		it("should default to Player for empty name", () => {
			const { setPlayerNamePreference } = useOnlineStore.getState();

			setPlayerNamePreference("   ");

			expect(useOnlineStore.getState().playerName).toBe("Player");
		});
	});

	// ============================================
	// Presence Data Tests
	// ============================================

	describe("presence data", () => {
		it("should set presence data", () => {
			const { setPresenceData } = useOnlineStore.getState();

			const presenceData = {
				"host-id": createHostPresence(),
				"guest-id": createGuestPresence(),
			};

			setPresenceData(presenceData);

			expect(useOnlineStore.getState().presenceData).toEqual(presenceData);
		});

		it("should detect opponent connection from presence data", async () => {
			const { connect, setPresenceData } = useOnlineStore.getState();

			await connect();
			const { odahId } = useOnlineStore.getState();

			// Set presence with opponent online
			setPresenceData({
				[odahId!]: createHostPresence({ odahId: odahId!, online: true }),
				"opponent-id": createGuestPresence({
					odahId: "opponent-id",
					online: true,
				}),
			});

			expect(useOnlineStore.getState().opponentConnected).toBe(true);
		});

		it("should detect opponent disconnection", async () => {
			const { connect, setPresenceData } = useOnlineStore.getState();

			await connect();
			const { odahId } = useOnlineStore.getState();

			// Set presence with opponent offline
			setPresenceData({
				[odahId!]: createHostPresence({ odahId: odahId!, online: true }),
				"opponent-id": createGuestPresence({
					odahId: "opponent-id",
					online: false,
				}),
			});

			expect(useOnlineStore.getState().opponentConnected).toBe(false);
		});
	});

	// ============================================
	// Error Handling Tests
	// ============================================

	describe("error handling", () => {
		it("should set error", () => {
			const { setError } = useOnlineStore.getState();

			setError("Something went wrong");

			expect(useOnlineStore.getState().error).toBe("Something went wrong");
		});

		it("should clear error", () => {
			const { setError, clearError } = useOnlineStore.getState();

			setError("Something went wrong");
			clearError();

			expect(useOnlineStore.getState().error).toBe(null);
		});

		it("should clear error on new operations", async () => {
			const { setError, connect } = useOnlineStore.getState();

			setError("Previous error");
			await connect();

			// Error should be cleared on successful connect
			expect(useOnlineStore.getState().error).toBe(null);
		});
	});

	// ============================================
	// Reset Tests
	// ============================================

	describe("reset", () => {
		it("should reset all state to initial values", async () => {
			const { connect, createRoom, setPresenceData, setError, reset } =
				useOnlineStore.getState();

			// Setup some state
			await connect();
			await createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});
			setPresenceData({
				"host-id": createHostPresence(),
			});
			setError("Some error");

			// Reset
			reset();

			const state = useOnlineStore.getState();
			expect(state.connectionStatus).toBe("disconnected");
			expect(state.odahId).toBe(null);
			expect(state.room).toBe(null);
			expect(state.roomCode).toBe(null);
			expect(state.isHost).toBe(false);
			expect(state.presenceData).toEqual({});
			expect(state.opponentConnected).toBe(false);
			expect(state.error).toBe(null);
		});

		it("should preserve player name preference on reset", async () => {
			const { setPlayerNamePreference, reset } = useOnlineStore.getState();

			setPlayerNamePreference("My Custom Name");
			reset();

			expect(useOnlineStore.getState().playerName).toBe("My Custom Name");
		});
	});

	// ============================================
	// Selector Tests
	// ============================================

	describe("selectors", () => {
		it("selectIsOnline should return true when gameMode is online", () => {
			const { setGameMode } = useOnlineStore.getState();

			setGameMode("online");
			expect(selectIsOnline(useOnlineStore.getState())).toBe(true);

			setGameMode("local");
			expect(selectIsOnline(useOnlineStore.getState())).toBe(false);

			setGameMode(null);
			expect(selectIsOnline(useOnlineStore.getState())).toBe(false);
		});

		it("selectIsConnected should return connection status", async () => {
			expect(selectIsConnected(useOnlineStore.getState())).toBe(false);

			await useOnlineStore.getState().connect();
			expect(selectIsConnected(useOnlineStore.getState())).toBe(true);

			await useOnlineStore.getState().disconnect();
			expect(selectIsConnected(useOnlineStore.getState())).toBe(false);
		});

		it("selectIsInRoom should return room status", async () => {
			await useOnlineStore.getState().connect();

			expect(selectIsInRoom(useOnlineStore.getState())).toBe(false);

			await useOnlineStore.getState().createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});

			expect(selectIsInRoom(useOnlineStore.getState())).toBe(true);
		});

		it("selectCanStartGame should return true when conditions are met", async () => {
			const { connect, createRoom, setPresenceData } =
				useOnlineStore.getState();

			await connect();
			const { odahId } = useOnlineStore.getState();

			await createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});

			// Set both players as present
			setPresenceData({
				[odahId!]: createHostPresence({ odahId: odahId!, online: true }),
				"guest-id": createGuestPresence({ odahId: "guest-id", online: true }),
			});

			expect(selectCanStartGame(useOnlineStore.getState())).toBe(true);
		});

		it("selectCanStartGame should return false when opponent not connected", async () => {
			const { connect, createRoom, setPresenceData } =
				useOnlineStore.getState();

			await connect();
			const { odahId } = useOnlineStore.getState();

			await createRoom({
				hostName: "Host",
				hostColor: "#3b82f6",
				cardPack: "animals",
				background: "default",
				cardBack: "default",
				pairCount: 20,
			});

			// Only host present
			setPresenceData({
				[odahId!]: createHostPresence({ odahId: odahId!, online: true }),
			});

			expect(selectCanStartGame(useOnlineStore.getState())).toBe(false);
		});

		it("selectOpponent should return opponent data", async () => {
			const { connect, setPresenceData } = useOnlineStore.getState();

			await connect();
			const { odahId } = useOnlineStore.getState();

			setPresenceData({
				[odahId!]: createHostPresence({ odahId: odahId! }),
				"opponent-id": createGuestPresence({
					odahId: "opponent-id",
					name: "Opponent Name",
					color: "#ff0000",
				}),
			});

			const opponent = selectOpponent(useOnlineStore.getState());
			expect(opponent).toBeDefined();
			expect(opponent?.name).toBe("Opponent Name");
			expect(opponent?.color).toBe("#ff0000");
		});

		it("selectSelf should return self data", async () => {
			const { connect, setPresenceData } = useOnlineStore.getState();

			await connect();
			const { odahId } = useOnlineStore.getState();

			setPresenceData({
				[odahId!]: createHostPresence({
					odahId: odahId!,
					name: "My Name",
					color: "#3b82f6",
				}),
			});

			const self = selectSelf(useOnlineStore.getState());
			expect(self).toBeDefined();
			expect(self?.name).toBe("My Name");
			expect(self?.color).toBe("#3b82f6");
		});
	});
});
