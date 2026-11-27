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

/**
 * Cleanup writes still in flight for a room and user: a leave's membership
 * write and presence stop, or a failed join's rollback. They target the same
 * documents and RTDB path as a rejoin, so a join to that room waits for them;
 * otherwise a stale cleanup could land after the rejoin and undo it. Queued
 * writes belong to a Firebase client and outlive any one adapter, so the
 * registry is kept per client rather than per adapter.
 */
const pendingCleanup = new WeakMap<
	FirebaseServices,
	Map<string, Set<Promise<unknown>>>
>();
const cleanupKey = (code: string, uid: string) => `${code}/${uid}`;

export class FirestoreSyncAdapter extends BaseSyncAdapter {
	/** How long a rejoin waits for the same room's earlier cleanup. */
	static cleanupWaitMs = 10_000;
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
	private trackCleanup(code: string, uid: string, work: Promise<unknown>) {
		let rooms = pendingCleanup.get(this.services);
		if (!rooms) pendingCleanup.set(this.services, (rooms = new Map()));
		const key = cleanupKey(code, uid);
		const pending = rooms.get(key) ?? new Set<Promise<unknown>>();
		rooms.set(key, pending);
		const settled = work.then(
			() => undefined,
			() => undefined,
		);
		pending.add(settled);
		void settled.then(() => {
			pending.delete(settled);
			if (pending.size === 0 && rooms.get(key) === pending) rooms.delete(key);
		});
	}
	private async awaitCleanup(code: string, uid: string) {
		const pending = pendingCleanup.get(this.services)?.get(cleanupKey(code, uid));
		if (!pending?.size) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finished = await Promise.race([
			Promise.all(pending).then(() => true),
			new Promise<false>((resolve) => {
				timer = setTimeout(
					() => resolve(false),
					FirestoreSyncAdapter.cleanupWaitMs,
				);
			}),
		]);
		clearTimeout(timer);
		// The cleanup stays registered: a later attempt must still wait for it.
		if (!finished)
			throw new Error(
				"Still finishing your previous visit to this room. Check your connection and try again.",
			);
	}
	private async presence(
		code: string,
		name: string,
		color: string,
		slot: 1 | 2,
	) {
		const uid = this.requireUser();
		const service = new PresenceService(
			code,
			uid,
			name,
			color,
			slot,
			this.services.rtdb,
		);
		this.presenceService = service;
		try {
			await service.start();
		} catch (error) {
			// Never keep a failed session. Its cleanup writes the same RTDB path a
			// retry will use, so register it for a same-room join to wait on.
			if (this.presenceService === service) this.presenceService = null;
			const stopping = service
				.stop()
				.catch((stopError) =>
					console.error("Failed to stop a failed presence session", stopError),
				);
			this.trackCleanup(code, uid, stopping);
			throw error;
		}
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
			try {
				await this.presence(code, options.hostName, options.hostColor, 1);
			} catch (error) {
				// Nobody can play in a room whose host never came online. Close it
				// rather than leaving this adapter attached to it.
				this.roomCode = null;
				this.isHost = false;
				this.trackCleanup(
					code,
					uid,
					updateDoc(reference, {
						status: "finished",
						lastActivity: serverTimestamp(),
					}).catch((closeError) =>
						console.error("Failed to close an abandoned room", closeError),
					),
				);
				throw error;
			}
			return code;
		}
		throw new Error("Failed to generate unique room code");
	}
	async joinRoom(roomCode: string, options: JoinRoomOptions): Promise<Room> {
		const uid = this.requireUser(),
			code = roomCode.toUpperCase();
		await this.awaitCleanup(code, uid);
		// The session may have ended while this join waited.
		if (this.requireUser() !== uid)
			throw new SyncError("disconnected", "Signed in as a different player");
		const reference = doc(this.services.db, "rooms", code);
		let claimedSlot = false;
		const room = await runTransaction(this.services.db, async (tx) => {
			// Firestore may rerun this callback; only the committed run counts.
			claimedSlot = false;
			const snapshot = await tx.get(reference);
			if (!snapshot.exists()) throw new Error("Room not found");
			const room = parseRoom(snapshot.data());
			// A host's leave or a failed creation closes the room for everyone.
			if (room.status === "finished") throw new Error("This room has closed");
			if (!room.playerSlots[uid]) {
				if (room.status !== "waiting")
					throw new Error("Game already in progress");
				if (Object.keys(room.playerSlots).length >= 2)
					throw new Error("Room is full");
				room.playerSlots[uid] = 2;
				claimedSlot = true;
				tx.update(reference, {
					[`playerSlots.${uid}`]: 2,
					lastActivity: serverTimestamp(),
				});
			}
			return room;
		});
		this.roomCode = code;
		this.isHost = room.hostId === uid;
		try {
			await this.presence(
				code,
				options.name,
				options.color,
				room.playerSlots[uid],
			);
		} catch (error) {
			// The join failed from the player's point of view. Give back a slot
			// this attempt claimed so the room is not left full.
			this.roomCode = null;
			this.isHost = false;
			// A retry waits for this release (registered cleanup), so it cannot
			// read the stale slot and then lose it when the release lands.
			if (claimedSlot)
				this.trackCleanup(
					code,
					uid,
					updateDoc(reference, {
						[`playerSlots.${uid}`]: deleteField(),
						lastActivity: serverTimestamp(),
					}).catch((releaseError) =>
						console.error("Failed to release a claimed slot", releaseError),
					),
				);
			throw error;
		}
		return room;
	}
	/**
	 * Detaches from the room synchronously, then submits the membership write and
	 * presence cleanup. The returned promise settles only when the server
	 * acknowledges them, which never happens while offline; callers that must not
	 * block on the network should not await it.
	 */
	leaveRoom() {
		const code = this.roomCode,
			uid = this.odahId,
			wasHost = this.isHost,
			presence = this.presenceService;
		if (!code || !uid) return Promise.resolve();
		// A guest's membership write revokes game-read permission. Detach before
		// submitting it, rather than leaving the listener alive during cleanup.
		for (const stop of this.subscriptions) stop();
		this.roomCode = null;
		this.isHost = false;
		this.presenceService = null;
		// Membership and presence are independent: a rejected membership write
		// must not leave this player advertised as online in the room.
		const cleanup = Promise.allSettled([
			updateDoc(
				doc(this.services.db, "rooms", code),
				wasHost
					? { status: "finished", lastActivity: serverTimestamp() }
					: {
							[`playerSlots.${uid}`]: deleteField(),
							lastActivity: serverTimestamp(),
						},
			),
			presence?.stop(),
		]);
		this.trackCleanup(code, uid, cleanup);
		return cleanup.then((results) => {
			const failure = results.find(
				(result): result is PromiseRejectedResult =>
					result.status === "rejected",
			);
			if (failure) throw failure.reason;
		});
	}
	async getRoom(code: string) {
		const snap = await getDocFromServer(
			doc(this.services.db, "rooms", code.toUpperCase()),
		);
		return snap.exists() ? parseRoom(snap.data()) : null;
	}
	subscribeToRoom(
		code: string,
		callback: (room: Room | null) => void,
		onError: (error: Error) => void,
	) {
		let active = true;
		const fail = (error: Error) => {
			if (active) onError(error);
		};
		const stop = onSnapshot(
			doc(this.services.db, "rooms", code),
			(snapshot) => {
				if (!active) return;
				// A join reads the room in a transaction, which does not populate the
				// local cache. Going offline before the first server snapshot then
				// yields a cache snapshot without the document: unknown, not deleted.
				if (!snapshot.exists() && snapshot.metadata.fromCache) return;
				let room: Room | null;
				try {
					room = snapshot.exists() ? parseRoom(snapshot.data()) : null;
				} catch (error) {
					fail(error as Error);
					return;
				}
				callback(room);
			},
			fail,
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
	/**
	 * Replaces the room's round. A lobby start passes `requireStatus: "waiting"`
	 * so it can never overwrite a round already in progress; a replay from the
	 * results screen replaces a finished round and omits it.
	 */
	async startGame(
		code: string,
		state: GameState,
		options: { requireStatus?: Room["status"] } = {},
	) {
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
			if (options.requireStatus && membership.status !== options.requireStatus)
				throw new Error(
					membership.status === "playing"
						? "A round is already in progress"
						: `Room is ${membership.status}`,
				);
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
