/**
 * ISyncAdapter - Interface for game state synchronization
 *
 * This abstraction allows swapping between local storage and Firestore
 * without changing the game logic. For local mode, the adapter is a no-op
 * since Zustand's persist middleware handles storage. For online mode,
 * the adapter syncs state to/from Firestore.
 */

import type {
	CardPack,
	GameState,
	OnlineGameState,
	Room,
	RoomConfig,
} from "../../types";

export interface CreateRoomOptions {
	hostId: string;
	hostName: string;
	hostColor: string;
	cardPack: CardPack;
	background: string;
	cardBack: string;
	pairCount: number;
}

export interface JoinRoomOptions {
	odahId: string;
	name: string;
	color: string;
}

export interface ISyncAdapter {
	// ============================================
	// Connection Lifecycle
	// ============================================

	/**
	 * Connect to the sync service (e.g., authenticate with Firebase)
	 */
	connect(): Promise<void>;

	/**
	 * Disconnect from the sync service
	 */
	disconnect(): Promise<void>;

	/**
	 * Check if connected
	 */
	isConnected(): boolean;

	// ============================================
	// Game State Operations
	// ============================================

	/**
	 * Get the current game state
	 */
	getState(): Promise<GameState | null>;

	/**
	 * Set/update the game state
	 */
	setState(state: GameState): Promise<void>;

	/**
	 * Subscribe to game state changes
	 * @returns Unsubscribe function
	 */
	subscribeToState(
		callback: (state: GameState) => void,
		onError?: (error: Error) => void,
	): () => void;

	// ============================================
	// Room Operations (Online mode only)
	// ============================================

	/**
	 * Create a new game room
	 * @returns Room code
	 */
	createRoom?(options: CreateRoomOptions): Promise<string>;

	/**
	 * Join an existing room
	 * @returns Room configuration
	 */
	joinRoom?(roomCode: string, options: JoinRoomOptions): Promise<Room>;

	/**
	 * Leave the current room
	 */
	leaveRoom?(): Promise<void>;

	/**
	 * Get room info
	 */
	getRoom?(roomCode: string): Promise<Room | null>;

	/**
	 * Subscribe to room changes
	 * @returns Unsubscribe function
	 */
	subscribeToRoom?(
		roomCode: string,
		callback: (room: Room | null) => void,
	): () => void;

	/**
	 * Update room configuration (host only)
	 */
	updateRoomConfig?(
		roomCode: string,
		config: Partial<RoomConfig>,
	): Promise<void>;

	/**
	 * Start the game (host only), returning the committed round and revision.
	 */
	startGame?(
		roomCode: string,
		initialState: GameState,
	): Promise<OnlineGameState>;
}

/**
 * Base class with default no-op implementations for optional methods
 */
export abstract class BaseSyncAdapter implements ISyncAdapter {
	abstract connect(): Promise<void>;
	abstract disconnect(): Promise<void>;
	abstract isConnected(): boolean;
	abstract getState(): Promise<GameState | null>;
	abstract setState(state: GameState): Promise<void>;
	abstract subscribeToState(
		callback: (state: GameState) => void,
		onError?: (error: Error) => void,
	): () => void;

	// Optional methods - default to throwing "not supported"
	createRoom?(_options: CreateRoomOptions): Promise<string>;
	joinRoom?(_roomCode: string, _options: JoinRoomOptions): Promise<Room>;
	leaveRoom?(): Promise<void>;
	getRoom?(_roomCode: string): Promise<Room | null>;
	subscribeToRoom?(
		_roomCode: string,
		_callback: (room: Room | null) => void,
	): () => void;
	updateRoomConfig?(
		_roomCode: string,
		_config: Partial<RoomConfig>,
	): Promise<void>;
	startGame?(
		_roomCode: string,
		_initialState: GameState,
	): Promise<OnlineGameState>;
}
