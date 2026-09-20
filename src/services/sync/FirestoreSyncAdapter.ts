import {
	instrumentAdapter,
	telemetrySyncObserver,
	type SyncObserver,
} from "../telemetry/syncObserver";
import { nextId } from "../telemetry/gameplay";
import {
	doc,
	getDocFromServer,
	onSnapshot,
	runTransaction,
	serverTimestamp,
	updateDoc,
	deleteField,
} from "firebase/firestore";
import services from "../../lib/firebase";
import type { FirebaseServices } from "../../lib/firebaseClient";
import type { GameState, Room, RoomConfig } from "../../types";
import { generateRoomCode } from "../game/GameEngine";
import {
	BaseSyncAdapter,
	type CreateRoomOptions,
	type JoinRoomOptions,
} from "./ISyncAdapter";
import { PresenceService } from "./PresenceService";
import {
	assertNextRevision,
	parseOnlineState,
	parseStoredOnlineState,
	parseRoom,
	serializeGame,
	SyncError,
} from "./stateProtocol";

export class FirestoreSyncAdapter extends BaseSyncAdapter {
	private connected = false;
	private roomCode: string | null = null;
	private odahId: string | null = null;
	private isHost = false;
	private presenceService: PresenceService | null = null;
	private subscriptions = new Set<() => void>();
	private services: FirebaseServices;
	private observer: SyncObserver;
	constructor(
		client: FirebaseServices = services,
		observer: SyncObserver = telemetrySyncObserver,
	) {
		super();
		this.services = client;
		this.observer = observer;
	}
	async connect() {
		if (this.connected) return;
		this.odahId = await this.services.getOrCreateUserId();
		this.connected = true;
	}
	async disconnect() {
		for (const stop of this.subscriptions) stop();
		this.subscriptions.clear();
		await this.presenceService?.stop();
		this.presenceService = null;
		this.connected = false;
		this.roomCode = null;
		this.isHost = false;
		this.odahId = null;
	}
	isConnected() {
		return this.connected;
	}
	getOdahId() {
		return this.odahId;
	}
	getRoomCode() {
		return this.roomCode;
	}
	getIsHost() {
		return this.isHost;
	}
	private requireUser() {
		if (!this.connected || !this.odahId)
			throw new SyncError("disconnected", "Not connected");
		return this.odahId;
	}
	private listen(stop: () => void) {
		const dispose = () => {
			stop();
			this.subscriptions.delete(dispose);
		};
		this.subscriptions.add(dispose);
		return dispose;
	}
	private async presence(
		code: string,
		name: string,
		color: string,
		slot: 1 | 2,
	) {
		await this.presenceService?.stop();
		this.presenceService = new PresenceService(
			code,
			this.requireUser(),
			name,
			color,
			slot,
			this.services.rtdb,
		);
		await this.presenceService.start();
	}
	async createRoom(options: CreateRoomOptions): Promise<string> {
		const uid = this.requireUser();
		for (let attempt = 0; attempt < 5; attempt++) {
			const code = generateRoomCode(),
				reference = doc(this.services.db, "rooms", code);
			const created = await runTransaction(this.services.db, async (tx) => {
				if ((await tx.get(reference)).exists()) return false;
				const room = {
					roomCode: code,
					hostId: uid,
					status: "waiting",
					config: {
						cardPack: options.cardPack,
						background: options.background,
						cardBack: options.cardBack,
						pairCount: options.pairCount,
					},
					playerSlots: { [uid]: 1 },
					createdAt: serverTimestamp(),
					lastActivity: serverTimestamp(),
				};
				parseRoom(room);
				tx.set(reference, room);
				return true;
			});
			if (!created) continue;
			this.roomCode = code;
			this.isHost = true;
			await this.presence(code, options.hostName, options.hostColor, 1);
			return code;
		}
		throw new Error("Failed to generate unique room code");
	}
	async joinRoom(roomCode: string, options: JoinRoomOptions): Promise<Room> {
		const uid = this.requireUser(),
			code = roomCode.toUpperCase();
		const reference = doc(this.services.db, "rooms", code);
		const room = await runTransaction(this.services.db, async (tx) => {
			const snapshot = await tx.get(reference);
			if (!snapshot.exists()) throw new Error("Room not found");
			const room = parseRoom(snapshot.data());
			if (!room.playerSlots[uid]) {
				if (room.status !== "waiting")
					throw new Error("Game already in progress");
				if (Object.keys(room.playerSlots).length >= 2)
					throw new Error("Room is full");
				room.playerSlots[uid] = 2;
				tx.update(reference, {
					[`playerSlots.${uid}`]: 2,
					lastActivity: serverTimestamp(),
				});
			}
			return room;
		});
		this.roomCode = code;
		this.isHost = room.hostId === uid;
		await this.presence(
			code,
			options.name,
			options.color,
			room.playerSlots[uid],
		);
		return room;
	}
	async leaveRoom() {
		if (!this.roomCode || !this.odahId) return;
		await updateDoc(
			doc(this.services.db, "rooms", this.roomCode),
			this.isHost
				? { status: "finished", lastActivity: serverTimestamp() }
				: {
						[`playerSlots.${this.odahId}`]: deleteField(),
						lastActivity: serverTimestamp(),
					},
		);
		await this.presenceService?.stop();
		this.presenceService = null;
		for (const stop of this.subscriptions) stop();
		this.roomCode = null;
		this.isHost = false;
	}
	async getRoom(code: string) {
		const snap = await getDocFromServer(
			doc(this.services.db, "rooms", code.toUpperCase()),
		);
		return snap.exists() ? parseRoom(snap.data()) : null;
	}
	subscribeToRoom(code: string, callback: (room: Room | null) => void) {
		return this.listen(
			onSnapshot(
				doc(this.services.db, "rooms", code),
				(snapshot) =>
					callback(snapshot.exists() ? parseRoom(snapshot.data()) : null),
				(error) => {
					console.error("Room subscription failed", error);
					callback(null);
				},
			),
		);
	}
	async updateRoomConfig(code: string, config: Partial<RoomConfig>) {
		if (!this.isHost) throw new Error("Only host can update room config");
		const updates: Record<string, unknown> = {
			lastActivity: serverTimestamp(),
		};
		for (const key of [
			"cardPack",
			"background",
			"cardBack",
			"pairCount",
		] as const)
			if (config[key] !== undefined) updates[`config.${key}`] = config[key];
		await updateDoc(doc(this.services.db, "rooms", code), updates);
	}
	async resetRoomToWaiting(code: string) {
		if (!this.isHost) throw new Error("Only host can reset room status");
		await updateDoc(doc(this.services.db, "rooms", code), {
			status: "waiting",
			lastActivity: serverTimestamp(),
		});
	}
	async startGame(code: string, state: GameState) {
		if (!this.isHost) throw new Error("Only host can start game");
		return runTransaction(this.services.db, async (tx) => {
			const game = doc(this.services.db, "games", code),
				room = doc(this.services.db, "rooms", code);
			const previous = await tx.get(game),
				roomSnap = await tx.get(room);
			const membership = parseRoom(roomSnap.data());
			if (Object.keys(membership.playerSlots).length !== 2)
				throw new Error("Both players must join before starting");
			const gameRound = previous.exists()
				? parseStoredOnlineState(previous.data()).gameRound + 1
				: 1;
			const next = parseOnlineState({
				...state,
				syncVersion: 1,
				gameRound,
			});
			tx.set(game, serializeGame(next));
			tx.update(room, { status: "playing", lastActivity: serverTimestamp() });
			// Resolve with this attempt's state only after Firestore commits it.
			// A separate listener-backed read can still hold the preceding snapshot.
			return next;
		});
	}
	async getState() {
		if (!this.roomCode) return null;
		const snap = await getDocFromServer(
			doc(this.services.db, "games", this.roomCode),
		);
		return snap.exists() ? parseStoredOnlineState(snap.data()) : null;
	}
	async setState(state: GameState) {
		if (!this.roomCode) throw new SyncError("disconnected", "Not in a room");
		const code = this.roomCode,
			next = parseOnlineState(state);
		const trace = this.observer.txStart(next, code);
		try {
			await runTransaction(this.services.db, async (tx) => {
				this.observer.txPhase(trace, "attempt");
				const reference = doc(this.services.db, "games", code),
					roomRef = doc(this.services.db, "rooms", code);
				const snapshot = await tx.get(reference);
				this.observer.txPhase(trace, "get-game");
				const roomSnap = await tx.get(roomRef);
				this.observer.txPhase(trace, "get-room");
				if (!snapshot.exists())
					throw new SyncError("conflict", "Game no longer exists");
				const current = parseStoredOnlineState(snapshot.data()),
					room = parseRoom(roomSnap.data());
				assertNextRevision(current, next);
				if (
					room.status !== "playing" ||
					room.playerSlots[this.requireUser()] !== current.currentPlayer ||
					next.lastUpdatedBy !== current.currentPlayer
				)
					throw new SyncError("conflict", "It is not your turn");
				tx.set(reference, serializeGame(next));
				tx.update(roomRef, { lastActivity: serverTimestamp() });
				this.observer.txPhase(trace, "commit");
			});
			this.observer.txEnd(trace);
		} catch (error) {
			this.observer.txEnd(trace, error);
			throw error;
		}
	}
	subscribeToState(
		callback: (state: GameState) => void,
		onError: (error: Error) => void = console.error,
	) {
		if (!this.roomCode) throw new SyncError("disconnected", "Not in a room");
		const code = this.roomCode;
		const listenerId = nextId();
		this.observer.listener(code, "subscribe", listenerId);
		const fail = (error: Error) => {
			this.observer.listener(code, "error", listenerId, error);
			onError(error);
		};
		const stop = onSnapshot(
			doc(this.services.db, "games", this.roomCode),
			{ includeMetadataChanges: true },
			(snapshot) => {
				this.observer.snapshotRaw(code, snapshot);
				// Only confirmed server snapshots may replace optimistic state.
				if (
					!snapshot.exists() ||
					snapshot.metadata.hasPendingWrites ||
					snapshot.metadata.fromCache
				)
					return;
				try {
					callback(parseStoredOnlineState(snapshot.data()));
				} catch (error) {
					fail(error as Error);
				}
			},
			fail,
		);
		return this.listen(() => {
			this.observer.listener(code, "unsubscribe", listenerId);
			stop();
		});
	}
	async updatePlayerName(name: string) {
		await this.presenceService?.updateName(name);
	}
	async updatePlayerColor(color: string) {
		await this.presenceService?.updateColor(color);
	}
}
let instance: FirestoreSyncAdapter | null = null;
export function getFirestoreSyncAdapter() {
	return (instance ??= instrumentAdapter(new FirestoreSyncAdapter()));
}
export function resetFirestoreSyncAdapter() {
	if (instance) void instance.disconnect().catch(console.error);
	instance = null;
}
