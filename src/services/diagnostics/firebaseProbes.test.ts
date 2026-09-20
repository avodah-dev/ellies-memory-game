import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	remove: vi.fn(),
	register: vi.fn(),
	offline: vi.fn(),
	delete: vi.fn(),
	copy: vi.fn(),
	stop: vi.fn(),
	user: { uid: "probe-user" },
	sharedDb: { shared: true },
	probeDb: { probe: true },
}));
vi.mock("../../lib/firebase", () => ({
	default: {
		getOrCreateUserId: vi.fn().mockResolvedValue("probe-user"),
		auth: { currentUser: mocks.user },
		db: mocks.sharedDb,
		app: { options: { projectId: "demo-matchimus" } },
	},
}));
vi.mock("firebase/app", () => ({
	initializeApp: () => ({}),
	deleteApp: mocks.delete,
}));
vi.mock("firebase/auth", () => ({
	initializeAuth: () => ({}),
	inMemoryPersistence: {},
	connectAuthEmulator: vi.fn(),
	updateCurrentUser: mocks.copy,
}));
vi.mock("firebase/firestore", () => ({
	doc: (_db: unknown, ...path: string[]) => path.join("/"),
	getDocFromServer: mocks.read,
}));
vi.mock("firebase/database", () => ({
	getDatabase: () => mocks.probeDb,
	connectDatabaseEmulator: vi.fn(),
	goOffline: mocks.offline,
	ref: (db: unknown, path: string) => ({ db, path }),
	remove: mocks.remove,
	set: mocks.write,
	onDisconnect: () => ({ remove: mocks.register }),
	onValue: (
		ref: { path: string },
		callback: (snapshot: { val: () => unknown }) => void,
	) => {
		queueMicrotask(() =>
			callback({ val: () => (ref.path === ".info/connected" ? true : 0) }),
		);
		return mocks.stop;
	},
}));
import { firestoreProbe, rtdbProbe } from "./firebaseProbes";
import { bounded } from "./connectionTest";
beforeEach(() => {
	vi.clearAllMocks();
	mocks.read.mockResolvedValue({ exists: () => false });
	mocks.write.mockResolvedValue(undefined);
	mocks.remove.mockResolvedValue(undefined);
	mocks.register.mockResolvedValue(undefined);
	mocks.delete.mockResolvedValue(undefined);
	mocks.copy.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());
it("reads only the reserved nonexistent room, with no queued reads after timeout", async () => {
	vi.useFakeTimers();
	mocks.read.mockReturnValue(new Promise(() => {}));
	const probe = firestoreProbe(new AbortController().signal);
	await vi.advanceTimersByTimeAsync(4000);
	expect(await probe).toMatchObject({ attempts: 1, failures: 1, samples: 0 });
	expect(mocks.read).toHaveBeenCalledExactlyOnceWith("rooms/0000");
});
it("registers cleanup first and waits for server ack before issuing another write", async () => {
	let ack!: () => void;
	mocks.write.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				ack = resolve;
			}),
	);
	const probe = rtdbProbe(new AbortController().signal);
	await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
	expect(mocks.register).toHaveBeenCalledOnce();
	expect(mocks.remove).not.toHaveBeenCalled();
	ack();
	expect(await probe).toMatchObject({
		samples: 5,
		attempts: 5,
		failures: 0,
		measured_rtdb_offset_ms: 0,
	});
	expect(
		mocks.write.mock.calls.every(
			([ref]) =>
				ref.path === "cursors/0000/probe-user" && ref.db === mocks.probeDb,
		),
	).toBe(true);
	expect(mocks.offline).toHaveBeenCalledWith(mocks.probeDb);
	expect(mocks.offline).not.toHaveBeenCalledWith(mocks.sharedDb);
	expect(mocks.copy).toHaveBeenCalledWith({}, mocks.user);
	expect(mocks.delete).toHaveBeenCalledOnce();
});
it("cancellation disconnects only the isolated connection and settles a stuck write", async () => {
	mocks.write.mockReturnValue(new Promise(() => {}));
	const controller = new AbortController();
	const probe = rtdbProbe(controller.signal);
	const caught = probe.catch((error) => error);
	await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
	controller.abort();
	expect((await caught).message).toBe("cancelled");
	expect(mocks.offline.mock.calls.every(([db]) => db === mocks.probeDb)).toBe(
		true,
	);
	expect(mocks.write).toHaveBeenCalledOnce();
	expect(mocks.delete).toHaveBeenCalledOnce();
});
it("hard timeout during cleanup registration cannot leave a later write running", async () => {
	vi.useFakeTimers();
	mocks.register.mockReturnValue(new Promise(() => {}));
	const controller = new AbortController();
	const probe = bounded(controller.signal, 1000, rtdbProbe).catch((e) => e);
	await vi.advanceTimersByTimeAsync(1000);
	expect((await probe).message).toBe("timeout");
	expect(mocks.write).not.toHaveBeenCalled();
	expect(mocks.offline).toHaveBeenCalledWith(mocks.probeDb);
	expect(mocks.delete).toHaveBeenCalledOnce();
});
