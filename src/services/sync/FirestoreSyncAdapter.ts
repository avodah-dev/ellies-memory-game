import {
	instrumentAdapter,
	isolateSyncObserver,
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
	writeBatch,
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
	private pendingMoves = new Set<Promise<void>>();
	private services: FirebaseServices;
	private observer: ReturnType<typeof isolateSyncObserver>;
	constructor(
		client: FirebaseServices = services,
		observer: SyncObserver = telemetrySyncObserver,
	) {
		super();
		this.services = client;
		this.observer = isolateSyncObserver(observer);
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
		let active = true;
		const dispose = () => {
			if (!active) return;
			active = false;
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
		// A guest's membership write revokes game-read permission. Detach before
		// submitting it, rather than leaving the listener alive during cleanup.
		for (const stop of this.subscriptions) stop();
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
		let active = true;
		const stop = onSnapshot(
			doc(this.services.db, "rooms", code),
			(snapshot) => {
				if (active)
					callback(snapshot.exists() ? parseRoom(snapshot.data()) : null);
			},
			(error) => {
				if (!active) return;
				console.error("Room subscription failed", error);
				callback(null);
			},
		);
		return this.listen(() => {
			active = false;
			stop();
		});
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
		// Round replacement is a lifecycle boundary. Already-submitted writes
		// cannot be cancelled; settle them before the transaction reads the round.
		await Promise.allSettled([...this.pendingMoves]);
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
		this.requireUser();
		const code = this.roomCode,
			next = parseOnlineState(state);
		const trace = this.observer.batchStart(next, code);
		const batch = writeBatch(this.services.db);
		// Update-only: ordinary moves cannot create a game. The unchanged rules
		// validate membership, turn, immutable deck, next revision and transition.
		batch.update(doc(this.services.db, "games", code), serializeGame(next));
		batch.update(doc(this.services.db, "rooms", code), {
			lastActivity: serverTimestamp(),
		});
		const pending = batch.commit();
		this.pendingMoves.add(pending);
		try {
			await pending;
			this.observer.batchEnd(trace);
		} catch (error) {
			this.observer.batchEnd(trace, error);
			throw error;
		} finally {
			this.pendingMoves.delete(pending);
		}
	}
	subscribeToState(
		callback: (state: GameState) => void,
		onError: (error: Error) => void = console.error,
	) {
		if (!this.roomCode) throw new SyncError("disconnected", "Not in a room");
		const code = this.roomCode;
		const listenerId = nextId();
		let active = true;
		this.observer.listener(code, "subscribe", listenerId);
		const fail = (error: Error) => {
			if (!active) return;
			this.observer.listener(code, "error", listenerId, error);
			onError(error);
		};
		const stop = onSnapshot(
			doc(this.services.db, "games", this.roomCode),
			{ includeMetadataChanges: true },
			(snapshot) => {
				if (!active) return;
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
			active = false;
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
