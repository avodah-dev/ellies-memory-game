import type { GameState } from "../../types";
import { track } from "./core";
import {
	errorCode,
	listenerStart,
	listenerStop,
	nextId,
	stateFields,
	writeTrace,
	type WriteTrace,
} from "./gameplay";
import type { Detail } from "./gameplayEvents";
export interface TransactionTrace {
	id: string;
	write: WriteTrace;
	at: number;
	phaseAt: number;
	commitAt: number | null;
	attempts: number;
	getGame: number;
	getRoom: number;
}
export interface RawSnapshot {
	exists(): boolean;
	metadata: { hasPendingWrites: boolean; fromCache: boolean };
	get(field: string): unknown;
}
export interface SyncObserver {
	batchStart(state: GameState, room: string): WriteTrace;
	batchEnd(write: WriteTrace, error?: unknown): void;
	txStart(state: GameState, room: string): TransactionTrace;
	txPhase(
		tx: TransactionTrace,
		phase: "attempt" | "get-game" | "get-room" | "commit",
	): void;
	txEnd(tx: TransactionTrace, error?: unknown): void;
	snapshotRaw(room: string, snapshot: RawSnapshot): void;
	listener(room: string, phase: string, id: string, error?: unknown): void;
	call(
		method: string,
		phase: string,
		id: string,
		at: number,
		fields: Detail,
		error?: unknown,
	): void;
}
const numeric = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
export const telemetrySyncObserver: SyncObserver = {
	batchStart(state, room) {
		const write = { ...writeTrace(state), at: performance.now() };
		track("mm.sync.write.start", {
			...write.fields,
			room_code: room,
			write_id: write.id,
			input_id: write.input,
			write_mode: "batch",
		});
		return write;
	},
	batchEnd(write, error) {
		const now = performance.now();
		track("mm.sync.write.result", {
			...write.fields,
			write_id: write.id,
			input_id: write.input,
			write_mode: "batch",
			ok: error === undefined,
			error_code: error === undefined ? null : errorCode(error),
			ms_commit: now - write.at,
			ms_input_to_commit: write.inputAt === null ? null : now - write.inputAt,
		});
	},
	txStart(state, room) {
		const at = performance.now();
		const value = {
			id: nextId(),
			write: writeTrace(state),
			at,
			phaseAt: at,
			commitAt: null,
			attempts: 0,
			getGame: 0,
			getRoom: 0,
		};
		track("mm.sync.write.start", {
			...value.write.fields,
			room_code: room,
			write_id: value.write.id,
			transaction_id: value.id,
			input_id: value.write.input,
		});
		return value;
	},
	txPhase(tx, phase) {
		const now = performance.now();
		if (phase === "attempt") {
			tx.attempts++;
			tx.commitAt = null;
		}
		if (phase === "get-game") tx.getGame += now - tx.phaseAt;
		if (phase === "get-room") tx.getRoom += now - tx.phaseAt;
		if (phase === "commit") tx.commitAt = now;
		track("mm.sync.tx.phase", {
			...tx.write.fields,
			transaction_id: tx.id,
			write_id: tx.write.id,
			input_id: tx.write.input,
			phase,
			attempt: tx.attempts,
			ms_elapsed: now - tx.phaseAt,
		});
		tx.phaseAt = now;
	},
	txEnd(tx, error) {
		const now = performance.now();
		track("mm.sync.write.result", {
			...tx.write.fields,
			transaction_id: tx.id,
			write_id: tx.write.id,
			input_id: tx.write.input,
			ok: error === undefined,
			error_code: error === undefined ? null : errorCode(error),
			attempts: tx.attempts,
			ms_get_game: tx.getGame,
			ms_get_room: tx.getRoom,
			ms_commit: tx.commitAt === null ? null : now - tx.commitAt,
			ms_tx_total: now - tx.at,
			ms_input_to_commit:
				tx.write.inputAt === null ? null : now - tx.write.inputAt,
		});
	},
	snapshotRaw(room, snapshot) {
		const exists = snapshot.exists(),
			pending = snapshot.metadata.hasPendingWrites,
			cache = snapshot.metadata.fromCache;
		track("mm.sync.snapshot.raw", {
			room_code: room,
			exists,
			pending_writes: pending,
			from_cache: cache,
			game_round: numeric(snapshot.get("gameRound")),
			sync_version: numeric(snapshot.get("syncVersion")),
			last_updated_by: numeric(snapshot.get("lastUpdatedBy")),
			decision: !exists
				? "missing"
				: pending
					? "pending-write"
					: cache
						? "cache"
						: "candidate",
		});
	},
	listener(room, phase, id, error) {
		track("mm.sync.listener", {
			room_code: room,
			phase,
			listener_id: id,
			layer: "adapter",
			error_code: error === undefined ? null : errorCode(error),
		});
	},
	call(method, phase, id, at, fields, error) {
		const props = {
			...fields,
			method,
			phase,
			call_id: id,
			ms_elapsed: performance.now() - at,
			error_code: error === undefined ? null : errorCode(error),
		};
		const events = {
			createRoom: "mm.room.create",
			joinRoom: "mm.room.join",
			startGame: "mm.room.start",
			leaveRoom: "mm.room.leave",
			resetRoomToWaiting: "mm.room.reset",
		} as const;
		track(events[method as keyof typeof events] ?? "mm.sync.call", props);
	},
};
export const noopSyncObserver: SyncObserver = {
	batchStart: writeTrace,
	batchEnd() {},
	txStart(state) {
		const at = performance.now();
		return {
			id: "",
			write: {
				id: "",
				at,
				input: null,
				inputAt: null,
				fields: stateFields(state),
			},
			at,
			phaseAt: at,
			commitAt: null,
			attempts: 0,
			getGame: 0,
			getRoom: 0,
		};
	},
	txPhase() {},
	txEnd() {},
	snapshotRaw() {},
	listener() {},
	call() {},
};
// An observer is record-only even when a custom implementation fails. A failed
// start explicitly disables that trace; it never substitutes another observer.
export function isolateSyncObserver(observer: SyncObserver) {
	const observe = (action: () => void) => {
		try {
			action();
		} catch {
			/* silent */
		}
	};
	return {
		batchStart(state: GameState, room: string): WriteTrace | null {
			try {
				return observer.batchStart(state, room);
			} catch {
				return null;
			}
		},
		batchEnd(write: WriteTrace | null, error?: unknown) {
			if (write !== null) observe(() => observer.batchEnd(write, error));
		},
		txStart(state: GameState, room: string): TransactionTrace | null {
			try {
				return observer.txStart(state, room);
			} catch {
				return null;
			}
		},
		txPhase(
			tx: TransactionTrace | null,
			phase: Parameters<SyncObserver["txPhase"]>[1],
		) {
			if (tx !== null) observe(() => observer.txPhase(tx, phase));
		},
		txEnd(tx: TransactionTrace | null, error?: unknown) {
			if (tx !== null) observe(() => observer.txEnd(tx, error));
		},
		snapshotRaw(room: string, snapshot: RawSnapshot) {
			observe(() => observer.snapshotRaw(room, snapshot));
		},
		listener(room: string, phase: string, id: string, error?: unknown) {
			observe(() => observer.listener(room, phase, id, error));
		},
	};
}
// Promise identity and receiver are preserved. Telemetry never changes a rejection.
export function instrumentAdapter<T extends object>(
	adapter: T,
	observer: SyncObserver = telemetrySyncObserver,
): T {
	const methods = new Map<PropertyKey, unknown>();
	const asyncMethods = new Set([
		"connect",
		"disconnect",
		"getState",
		"setState",
		"createRoom",
		"joinRoom",
		"leaveRoom",
		"getRoom",
		"updateRoomConfig",
		"resetRoomToWaiting",
		"startGame",
		"updatePlayerName",
		"updatePlayerColor",
	]);
	return new Proxy(adapter, {
		get(target, key) {
			const member = Reflect.get(target, key, target);
			if (typeof member !== "function") return member;
			if (methods.has(key)) return methods.get(key);
			const wrapped = (...args: unknown[]) => {
				if (!asyncMethods.has(String(key)))
					return Reflect.apply(member, target, args);
				const at = performance.now(),
					id = nextId();
				const fields: Detail = {};
				const roomGetter = Reflect.get(target, "getRoomCode");
				if (typeof roomGetter === "function")
					fields.room_code = Reflect.apply(roomGetter, target, []);
				if (
					[
						"joinRoom",
						"getRoom",
						"updateRoomConfig",
						"resetRoomToWaiting",
						"startGame",
					].includes(String(key)) &&
					typeof args[0] === "string"
				)
					fields.room_code = args[0];
				// Never serialize arguments/results: they can contain names and full decks.
				const report = (phase: string, error?: unknown) => {
					try {
						observer.call(String(key), phase, id, at, fields, error);
					} catch {
						/* silent */
					}
				};
				report("start");
				try {
					const result = Reflect.apply(member, target, args);
					if (result && typeof result.then === "function")
						void result.then(
							(value: unknown) => {
								if (key === "createRoom" && typeof value === "string")
									fields.room_code = value;
								report("resolved");
							},
							(error: unknown) => report("rejected", error),
						);
					return result;
				} catch (error) {
					report("threw", error);
					throw error;
				}
			};
			methods.set(key, wrapped);
			return wrapped;
		},
	});
}
export function observedListener(
	stop: () => void,
	id: string,
	layer: string,
	room: string | undefined,
) {
	return () => {
		listenerStop(id, layer, room);
		stop();
	};
}
export { listenerStart };
