import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { FirestoreSyncAdapter } from "./FirestoreSyncAdapter";
import type { FirebaseServices } from "../../lib/firebaseClient";
import { noopSyncObserver } from "../telemetry/syncObserver";
import { createTestRoom } from "../../test/testUtils";

const mock = vi.hoisted(() => ({
	update: vi.fn(),
	transaction: vi.fn(),
	presenceStop: vi.fn(),
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
		start = vi.fn().mockResolvedValue(undefined);
		stop = mock.presenceStop;
	},
}));
const room = createTestRoom({ playerSlots: { "host-odah-id": 1, guest: 2 } });
const permission = Object.assign(new Error("permission denied"), {
	code: "permission-denied",
});
const services = {
	getOrCreateUserId: async () => "guest",
	db: {},
	rtdb: {},
} as unknown as FirebaseServices;
const observer = {
	...noopSyncObserver,
	listener: vi.fn(),
	snapshotRaw: vi.fn(),
};
const snapshot = { exists: () => true, data: () => room };
beforeEach(() => {
	vi.clearAllMocks();
	mock.listeners.length = 0;
	mock.update.mockReset().mockResolvedValue(undefined);
	mock.presenceStop.mockReset().mockResolvedValue(undefined);
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
		roomStop = adapter.subscribeToRoom("ABCD", roomChanged);
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
		roomChanged = vi.fn();
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const stopState = adapter.subscribeToState(vi.fn(), stateError);
	const stopRoom = adapter.subscribeToRoom("ABCD", roomChanged);
	mock.listeners[0].error(permission);
	mock.listeners[1].next(snapshot);
	mock.listeners[1].error(permission);
	expect(stateError).toHaveBeenCalledExactlyOnceWith(permission);
	expect(roomChanged).toHaveBeenCalledWith(room);
	expect(roomChanged).toHaveBeenLastCalledWith(null);
	expect(error).toHaveBeenCalledOnce();
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
	expect(roomChanged).toHaveBeenCalledTimes(2);
	expect(error).toHaveBeenCalledOnce();
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
