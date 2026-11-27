import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FirestoreSyncAdapter } from "./FirestoreSyncAdapter";
import type { FirebaseServices } from "../../lib/firebaseClient";
import { noopSyncObserver } from "../telemetry/syncObserver";
import { createTestRoom } from "../../test/testUtils";

const mock = vi.hoisted(() => ({
	update: vi.fn(),
	transaction: vi.fn(),
	presenceStop: vi.fn(),
	presenceStart: vi.fn(),
	listeners: [] as Array<{
		next: (snapshot: unknown) => void;
		error: (error: Error) => void;
		stop: ReturnType<typeof vi.fn>;
	}>,
}));
vi.mock("../../lib/firebase", () => ({ default: {}, rtdb: {} }));
vi.mock("firebase/firestore", async (importOriginal) => ({
	...(await importOriginal<typeof import("firebase/firestore")>()),
	doc: (_db: unknown, ...path: string[]) => path.join("/"),
	updateDoc: mock.update,
	runTransaction: mock.transaction,
	onSnapshot: (_ref: unknown, ...args: unknown[]) => {
		const stop = vi.fn();
		mock.listeners.push({
			next: args.at(-2) as (s: unknown) => void,
			error: args.at(-1) as (e: Error) => void,
			stop,
		});
		return stop;
	},
}));
vi.mock("./PresenceService", () => ({
	PresenceService: class {
		start = mock.presenceStart;
		stop = mock.presenceStop;
	},
}));
const room = createTestRoom({ playerSlots: { "host-odah-id": 1, guest: 2 } });
const permission = Object.assign(new Error("permission denied"), {
	code: "permission-denied",
});
// Pending cleanup is tracked per Firebase client, so each test gets its own.
const freshServices = () =>
	({
		getOrCreateUserId: async () => "guest",
		db: {},
		rtdb: {},
	}) as unknown as FirebaseServices;
let services = freshServices();
const observer = {
	...noopSyncObserver,
	listener: vi.fn(),
	snapshotRaw: vi.fn(),
};
const snapshot = {
	exists: () => true,
	data: () => room,
	metadata: { fromCache: false },
};
beforeEach(() => {
	services = freshServices();
	FirestoreSyncAdapter.cleanupWaitMs = 10_000;
	vi.clearAllMocks();
	mock.listeners.length = 0;
	mock.update.mockReset().mockResolvedValue(undefined);
	mock.presenceStop.mockReset().mockResolvedValue(undefined);
	mock.presenceStart.mockReset().mockResolvedValue(undefined);
	mock.transaction.mockImplementation(async (_db, action) =>
		action({ get: async () => snapshot }),
	);
});
afterEach(() => vi.restoreAllMocks());
async function joined() {
	const adapter = new FirestoreSyncAdapter(services, observer);
	await adapter.connect();
	await adapter.joinRoom("ABCD", {
		odahId: "guest",
		name: "Guest",
		color: "red",
	});
	return adapter;
}
it("detaches both listeners before membership revocation, ignoring late errors and snapshots through presence cleanup", async () => {
	const adapter = await joined();
	const state = vi.fn(),
		failed = vi.fn(),
		roomChanged = vi.fn();
	const stateStop = adapter.subscribeToState(state, failed),
		roomStop = adapter.subscribeToRoom("ABCD", roomChanged, failed);
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	let finishPresence!: () => void;
	mock.presenceStop.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finishPresence = resolve;
			}),
	);
	mock.update.mockImplementation(async () => {
		for (const listener of mock.listeners) {
			expect(listener.stop).toHaveBeenCalledOnce();
			listener.error(permission);
			listener.next(snapshot);
		}
	});
	const leaving = adapter.leaveRoom();
	await vi.waitFor(() => expect(mock.presenceStop).toHaveBeenCalledOnce());
	for (const listener of mock.listeners) listener.error(permission);
	expect(failed).not.toHaveBeenCalled();
	expect(state).not.toHaveBeenCalled();
	expect(roomChanged).not.toHaveBeenCalled();
	expect(error).not.toHaveBeenCalled();
	expect(observer.snapshotRaw).not.toHaveBeenCalled();
	expect(
		observer.listener.mock.calls.filter((c) => c[1] === "error"),
	).toHaveLength(0);
	finishPresence();
	await leaving;
	stateStop();
	roomStop();
	await adapter.disconnect();
	for (const listener of mock.listeners)
		expect(listener.stop).toHaveBeenCalledOnce();
	expect(
		observer.listener.mock.calls.filter((c) => c[1] === "unsubscribe"),
	).toHaveLength(1);
});
it("preserves active listener errors and room delivery; disposal is idempotent and invalidates queued callbacks", async () => {
	const adapter = await joined();
	const stateError = vi.fn(),
		roomChanged = vi.fn(),
		roomError = vi.fn();
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const stopState = adapter.subscribeToState(vi.fn(), stateError);
	const stopRoom = adapter.subscribeToRoom("ABCD", roomChanged, roomError);
	mock.listeners[0].error(permission);
	mock.listeners[1].next(snapshot);
	mock.listeners[1].error(permission);
	expect(stateError).toHaveBeenCalledExactlyOnceWith(permission);
	// A listener failure is an error, never a "room missing" null.
	expect(roomChanged).toHaveBeenCalledExactlyOnceWith(room);
	expect(roomError).toHaveBeenCalledExactlyOnceWith(permission);
	expect(error).not.toHaveBeenCalled();
	stopState();
	stopRoom();
	stopState();
	stopRoom();
	for (const listener of mock.listeners) {
		listener.error(permission);
		listener.next(snapshot);
		expect(listener.stop).toHaveBeenCalledOnce();
	}
	expect(stateError).toHaveBeenCalledTimes(1);
	expect(roomChanged).toHaveBeenCalledTimes(1);
	expect(roomError).toHaveBeenCalledTimes(1);
	expect(error).not.toHaveBeenCalled();
	await adapter.disconnect();
});
it("still rejects the original leave-write error after detaching, without manufacturing a listener error", async () => {
	const adapter = await joined();
	const failed = vi.fn();
	adapter.subscribeToState(vi.fn(), failed);
	mock.update.mockRejectedValue(permission);
	await expect(adapter.leaveRoom()).rejects.toBe(permission);
	expect(mock.listeners[0].stop).toHaveBeenCalledOnce();
	mock.listeners[0].error(permission);
	expect(failed).not.toHaveBeenCalled();
	await adapter.disconnect();
});
it("invalidates callbacks synchronously when disconnect starts, before presence finishes", async () => {
	const adapter = await joined();
	const failed = vi.fn();
	adapter.subscribeToState(vi.fn(), failed);
	let finish!: () => void;
	mock.presenceStop.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const disconnecting = adapter.disconnect();
	expect(mock.listeners[0].stop).toHaveBeenCalledOnce();
	mock.listeners[0].error(permission);
	expect(failed).not.toHaveBeenCalled();
	finish();
	await disconnecting;
});

it("routes a malformed room snapshot to the error callback instead of throwing from the listener", async () => {
	const adapter = await joined();
	const roomChanged = vi.fn(),
		roomError = vi.fn();
	adapter.subscribeToRoom("ABCD", roomChanged, roomError);
	expect(() =>
		mock.listeners[0].next({ exists: () => true, data: () => ({ roomCode: 7 }) }),
	).not.toThrow();
	expect(roomChanged).not.toHaveBeenCalled();
	expect(roomError).toHaveBeenCalledOnce();
	expect(roomError.mock.calls[0][0]).toBeInstanceOf(Error);
	mock.listeners[0].next({
		exists: () => false,
		data: () => undefined,
		metadata: { fromCache: false },
	});
	expect(roomChanged).toHaveBeenCalledExactlyOnceWith(null);
	await adapter.disconnect();
});
it("leaves the room locally at once while the membership write is still unacknowledged", async () => {
	const adapter = await joined();
	const failed = vi.fn();
	adapter.subscribeToState(vi.fn(), failed);
	let acknowledge!: () => void;
	mock.update.mockReturnValue(
		new Promise<void>((resolve) => {
			acknowledge = resolve;
		}),
	);
	const leaving = adapter.leaveRoom();
	expect(adapter.getRoomCode()).toBeNull();
	expect(adapter.getIsHost()).toBe(false);
	expect(mock.listeners[0].stop).toHaveBeenCalledOnce();
	expect(mock.update).toHaveBeenCalledExactlyOnceWith("rooms/ABCD", {
		"playerSlots.guest": expect.anything(),
		lastActivity: expect.anything(),
	});
	// Presence cleanup does not depend on the membership acknowledgement.
	expect(mock.presenceStop).toHaveBeenCalledOnce();
	acknowledge();
	await leaving;
	await adapter.leaveRoom();
	expect(mock.update).toHaveBeenCalledOnce();
	await adapter.disconnect();
});
it("a host leaving finishes the room", async () => {
	const host = new FirestoreSyncAdapter(
		{ ...services, getOrCreateUserId: async () => "host-odah-id" },
		observer,
	);
	await host.connect();
	await host.joinRoom("ABCD", { odahId: "host-odah-id", name: "Host", color: "red" });
	expect(host.getIsHost()).toBe(true);
	await host.leaveRoom();
	expect(mock.update).toHaveBeenCalledExactlyOnceWith("rooms/ABCD", {
		status: "finished",
		lastActivity: expect.anything(),
	});
	await host.disconnect();
});
it("closes a newly created room and detaches when the host's presence cannot start", async () => {
	const host = new FirestoreSyncAdapter(
		{ ...services, getOrCreateUserId: async () => "host-odah-id" },
		observer,
	);
	await host.connect();
	mock.transaction.mockImplementation(async (_db, action) =>
		action({ get: async () => ({ exists: () => false }), set: vi.fn() }),
	);
	const timeout = new Error("Presence connection timeout");
	mock.presenceStart.mockRejectedValueOnce(timeout);
	await expect(
		host.createRoom({
			hostId: "host-odah-id",
			hostName: "Host",
			hostColor: "red",
			cardPack: "animals",
			background: "default",
			cardBack: "default",
			pairCount: 4,
		}),
	).rejects.toBe(timeout);
	expect(host.getRoomCode()).toBeNull();
	expect(host.getIsHost()).toBe(false);
	expect(mock.update).toHaveBeenCalledExactlyOnceWith(
		expect.stringMatching(/^rooms\/[A-Z0-9]{4}$/),
		{ status: "finished", lastActivity: expect.anything() },
	);
	await host.disconnect();
});
it("stops presence even when the membership write is rejected, and still reports the rejection", async () => {
	const adapter = await joined();
	mock.update.mockRejectedValue(permission);
	await expect(adapter.leaveRoom()).rejects.toBe(permission);
	expect(mock.presenceStop).toHaveBeenCalledOnce();
	await adapter.disconnect();
});
it("makes a same-room rejoin wait for the previous leave's cleanup", async () => {
	const adapter = await joined();
	let acknowledge!: () => void;
	mock.update.mockReturnValueOnce(
		new Promise<void>((resolve) => {
			acknowledge = resolve;
		}),
	);
	void adapter.leaveRoom();
	mock.transaction.mockClear();
	const rejoining = adapter.joinRoom("abcd", {
		odahId: "guest",
		name: "Guest",
		color: "red",
	});
	await new Promise((r) => setTimeout(r, 10));
	// The join transaction must not read membership before the leave commits.
	expect(mock.transaction).not.toHaveBeenCalled();
	acknowledge();
	await rejoining;
	expect(mock.transaction).toHaveBeenCalledOnce();
	expect(adapter.getRoomCode()).toBe("ABCD");
	await adapter.disconnect();
});
it("does not make a join to a different room wait for an unrelated leave", async () => {
	const adapter = await joined();
	mock.update.mockReturnValueOnce(new Promise<void>(() => {}));
	void adapter.leaveRoom();
	const other = { ...room, roomCode: "WXYZ" };
	mock.transaction.mockImplementation(async (_db, action) =>
		action({ get: async () => ({ exists: () => true, data: () => other }) }),
	);
	await adapter.joinRoom("WXYZ", { odahId: "guest", name: "Guest", color: "red" });
	expect(adapter.getRoomCode()).toBe("WXYZ");
	await adapter.disconnect();
});
it("releases the claimed slot and detaches when presence fails after joining", async () => {
	const adapter = new FirestoreSyncAdapter(services, observer);
	await adapter.connect();
	const waiting = createTestRoom({ roomCode: "ABCD" });
	const update = vi.fn();
	mock.transaction.mockImplementation(async (_db, action) =>
		action({
			get: async () => ({ exists: () => true, data: () => waiting }),
			update,
		}),
	);
	const timeout = new Error("Presence connection timeout");
	mock.presenceStart.mockRejectedValueOnce(timeout);
	await expect(
		adapter.joinRoom("ABCD", { odahId: "guest", name: "Guest", color: "red" }),
	).rejects.toBe(timeout);
	expect(update).toHaveBeenCalledOnce();
	expect(adapter.getRoomCode()).toBeNull();
	expect(mock.update).toHaveBeenCalledExactlyOnceWith("rooms/ABCD", {
		"playerSlots.guest": expect.anything(),
		lastActivity: expect.anything(),
	});
	// The failed session is stopped in the background and never awaited again.
	expect(mock.presenceStop).toHaveBeenCalledOnce();
	await adapter.disconnect();
	expect(mock.presenceStop).toHaveBeenCalledOnce();
});
it("refuses a lobby start that would replace a round in progress", async () => {
	const host = new FirestoreSyncAdapter(
		{ ...services, getOrCreateUserId: async () => "host-odah-id" },
		observer,
	);
	await host.connect();
	await host.joinRoom("ABCD", { odahId: "host-odah-id", name: "Host", color: "red" });
	const playing = { ...room, status: "playing" };
	const set = vi.fn();
	mock.transaction.mockImplementation(async (_db, action) =>
		action({
			get: async (path: string) =>
				path.startsWith("rooms/")
					? { exists: () => true, data: () => playing }
					: { exists: () => false },
			set,
			update: vi.fn(),
		}),
	);
	await expect(
		host.startGame("ABCD", {} as never, { requireStatus: "waiting" }),
	).rejects.toThrow("A round is already in progress");
	expect(set).not.toHaveBeenCalled();
	await host.disconnect();
});

function gate() {
	let open!: () => void;
	const promise = new Promise<void>((resolve) => {
		open = resolve;
	});
	return { promise, open };
}
const settle = () => new Promise((r) => setTimeout(r, 10));
const roomIn = (code: string, extra: Partial<typeof room> = {}) => ({
	exists: () => true,
	data: () => ({ ...room, roomCode: code, ...extra }),
});
function rooms(byCode: Record<string, () => unknown>) {
	mock.transaction.mockImplementation(async (_db, action) =>
		action({
			get: async (path: string) => byCode[path.split("/")[1]](),
			update: vi.fn(),
		}),
	);
}
it("keeps each room's cleanup barrier when the player leaves another room in between", async () => {
	const adapter = await joined();
	const slowLeave = gate();
	mock.update.mockReturnValueOnce(slowLeave.promise);
	void adapter.leaveRoom(); // ABCD cleanup stays pending
	rooms({ ABCD: () => roomIn("ABCD"), WXYZ: () => roomIn("WXYZ") });
	await adapter.joinRoom("WXYZ", { odahId: "guest", name: "G", color: "red" });
	await adapter.leaveRoom(); // WXYZ cleanup settles at once
	mock.transaction.mockClear();
	const rejoining = adapter.joinRoom("ABCD", {
		odahId: "guest",
		name: "G",
		color: "red",
	});
	await settle();
	expect(mock.transaction).not.toHaveBeenCalled();
	slowLeave.open();
	await rejoining;
	expect(mock.transaction).toHaveBeenCalledOnce();
	await adapter.disconnect();
});
it("makes a retry wait for a failed join's slot release", async () => {
	const adapter = new FirestoreSyncAdapter(services, observer);
	await adapter.connect();
	rooms({ ABCD: () => roomIn("ABCD", { playerSlots: { "host-odah-id": 1 } }) });
	const release = gate();
	mock.update.mockReturnValueOnce(release.promise);
	mock.presenceStart.mockRejectedValueOnce(new Error("Presence connection timeout"));
	await expect(
		adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" }),
	).rejects.toThrow("Presence connection timeout");
	mock.transaction.mockClear();
	const retry = adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" });
	await settle();
	// Reading membership now would see the stale claim, then lose it.
	expect(mock.transaction).not.toHaveBeenCalled();
	release.open();
	await retry;
	expect(mock.transaction).toHaveBeenCalledOnce();
	await adapter.disconnect();
});
it("makes a retry wait for a failed presence session's cleanup", async () => {
	const adapter = new FirestoreSyncAdapter(services, observer);
	await adapter.connect();
	rooms({ ABCD: () => roomIn("ABCD") });
	const stopped = gate();
	mock.presenceStop.mockReturnValueOnce(stopped.promise);
	mock.presenceStart.mockRejectedValueOnce(new Error("Presence connection timeout"));
	await expect(
		adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" }),
	).rejects.toThrow();
	mock.transaction.mockClear();
	const retry = adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" });
	await settle();
	expect(mock.transaction).not.toHaveBeenCalled();
	stopped.open();
	await retry;
	expect(adapter.getRoomCode()).toBe("ABCD");
	await adapter.disconnect();
});
it("gives up waiting on stuck cleanup with a clear error, and keeps the barrier", async () => {
	const adapter = await joined();
	FirestoreSyncAdapter.cleanupWaitMs = 20;
	mock.update.mockReturnValueOnce(new Promise<void>(() => {}));
	void adapter.leaveRoom();
	mock.transaction.mockClear();
	for (let attempt = 0; attempt < 2; attempt++)
		await expect(
			adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" }),
		).rejects.toThrow("Still finishing your previous visit to this room");
	expect(mock.transaction).not.toHaveBeenCalled();
	await adapter.disconnect();
});
it("does not join after the session ends while waiting on cleanup", async () => {
	const adapter = await joined();
	const slowLeave = gate();
	mock.update.mockReturnValueOnce(slowLeave.promise);
	void adapter.leaveRoom();
	mock.transaction.mockClear();
	const rejoining = adapter.joinRoom("ABCD", {
		odahId: "guest",
		name: "G",
		color: "red",
	});
	await settle();
	await adapter.disconnect();
	slowLeave.open();
	await expect(rejoining).rejects.toMatchObject({ code: "disconnected" });
	expect(mock.transaction).not.toHaveBeenCalled();
});
it("refuses to rejoin a closed room, even as a member", async () => {
	const adapter = new FirestoreSyncAdapter(services, observer);
	await adapter.connect();
	rooms({ ABCD: () => roomIn("ABCD", { status: "finished" }) });
	await expect(
		adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" }),
	).rejects.toThrow("This room has closed");
	expect(adapter.getRoomCode()).toBeNull();
	expect(mock.presenceStart).not.toHaveBeenCalled();
	await adapter.disconnect();
});
it("decides whether a slot was claimed from the committed transaction run only", async () => {
	const adapter = new FirestoreSyncAdapter(services, observer);
	await adapter.connect();
	// First run sees a free seat and claims it; Firestore reruns the callback and
	// the committed run finds the player already a member.
	const runs = [
		roomIn("ABCD", { playerSlots: { "host-odah-id": 1 } }),
		roomIn("ABCD"),
	];
	mock.transaction.mockImplementation(async (_db, action) => {
		let result;
		for (const snapshot of runs)
			result = await action({ get: async () => snapshot, update: vi.fn() });
		return result;
	});
	mock.presenceStart.mockRejectedValueOnce(new Error("Presence connection timeout"));
	await expect(
		adapter.joinRoom("ABCD", { odahId: "guest", name: "G", color: "red" }),
	).rejects.toThrow();
	// The member's existing seat must not be released.
	expect(mock.update).not.toHaveBeenCalled();
	await adapter.disconnect();
});
it("treats a missing room in a cache-only snapshot as unknown, not deleted", async () => {
	const adapter = await joined();
	const roomChanged = vi.fn(),
		roomError = vi.fn();
	adapter.subscribeToRoom("ABCD", roomChanged, roomError);
	mock.listeners[0].next({
		exists: () => false,
		data: () => undefined,
		metadata: { fromCache: true },
	});
	expect(roomChanged).not.toHaveBeenCalled();
	expect(roomError).not.toHaveBeenCalled();
	mock.listeners[0].next(snapshot);
	expect(roomChanged).toHaveBeenCalledExactlyOnceWith(room);
	await adapter.disconnect();
});
