import { afterEach, expect, it, vi } from "vitest";
import {
	instrumentAdapter,
	isolateSyncObserver,
	noopSyncObserver,
	telemetrySyncObserver,
} from "./syncObserver";
import { track } from "./core";
import { createTestOnlineGameState } from "../../test/testUtils";
vi.mock("./core", () => ({
	track: vi.fn(),
	currentInputId: () => null,
	getContext: () => ({}),
}));
afterEach(() => {
	vi.restoreAllMocks();
	vi.clearAllMocks();
});
it("preserves receiver, method identity, result promise and rejection object", async () => {
	const error = new Error("private payload");
	const promise = Promise.reject(error);
	void promise.catch(() => {});
	const raw = {
		value: 4,
		isConnected() {
			return this.value === 4;
		},
		getState() {
			expect(this).toBe(raw);
			return promise;
		},
	};
	const call = vi.fn();
	const proxy = instrumentAdapter(raw, { ...noopSyncObserver, call });
	expect(proxy.isConnected()).toBe(true);
	expect(proxy.getState).toBe(proxy.getState);
	const result = proxy.getState();
	expect(result).toBe(promise);
	await expect(result).rejects.toBe(error);
	expect(call.mock.calls.map((c) => c[1])).toEqual(["start", "rejected"]);
});
it("does not let observer failures change a successful result", async () => {
	const promise = Promise.resolve(4);
	const proxy = instrumentAdapter(
		{ getState: () => promise },
		{
			...noopSyncObserver,
			call() {
				throw new Error("telemetry");
			},
		},
	);
	expect(proxy.getState()).toBe(promise);
	await expect(promise).resolves.toBe(4);
});
it("counts retries and measures read phases independently of commit tail", () => {
	let time = 0;
	vi.spyOn(performance, "now").mockImplementation(() => time);
	const tx = telemetrySyncObserver.txStart(createTestOnlineGameState(), "TEST");
	telemetrySyncObserver.txPhase(tx, "attempt");
	time = 10;
	telemetrySyncObserver.txPhase(tx, "get-game");
	time = 30;
	telemetrySyncObserver.txPhase(tx, "get-room");
	time = 35;
	telemetrySyncObserver.txPhase(tx, "commit");
	time = 50;
	telemetrySyncObserver.txPhase(tx, "attempt");
	time = 60;
	telemetrySyncObserver.txPhase(tx, "get-game");
	time = 80;
	telemetrySyncObserver.txPhase(tx, "get-room");
	time = 85;
	telemetrySyncObserver.txPhase(tx, "commit");
	time = 100;
	telemetrySyncObserver.txEnd(tx);
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.result",
		expect.objectContaining({
			attempts: 2,
			ms_get_game: 20,
			ms_get_room: 40,
			ms_commit: 15,
			ms_tx_total: 100,
			ok: true,
		}),
	);
	telemetrySyncObserver.txEnd(tx, {
		code: "permission-denied",
		message: "private",
	});
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.result",
		expect.objectContaining({ ok: false, error_code: "permission-denied" }),
	);
});
it("records each raw snapshot decision without serializing the document", () => {
	for (const [exists, pending, cache, decision] of [
		[false, false, false, "missing"],
		[true, true, false, "pending-write"],
		[true, false, true, "cache"],
		[true, false, false, "candidate"],
	] as const) {
		telemetrySyncObserver.snapshotRaw("TEST", {
			exists: () => exists,
			metadata: { hasPendingWrites: pending, fromCache: cache },
			get: () => 2,
		});
		expect(track).toHaveBeenLastCalledWith(
			"mm.sync.snapshot.raw",
			expect.objectContaining({
				exists,
				pending_writes: pending,
				from_cache: cache,
				decision,
				sync_version: 2,
			}),
		);
	}
});
it("isolates every adapter observer hook, including a failed trace start", async () => {
	const { isolateSyncObserver } = await import("./syncObserver");
	const fail = vi.fn(() => {
		throw new Error("observer failure");
	});
	const observer = isolateSyncObserver({
		...noopSyncObserver,
		txStart: fail,
		txPhase: fail,
		txEnd: fail,
		snapshotRaw: fail,
		listener: fail,
	});
	const state = createTestOnlineGameState();
	const trace = observer.txStart(state, "TEST");
	expect(trace).toBeNull();
	expect(() => observer.txPhase(trace, "attempt")).not.toThrow();
	expect(() => observer.txEnd(trace)).not.toThrow();
	const live = noopSyncObserver.txStart(state, "TEST");
	expect(() => observer.txPhase(live, "get-game")).not.toThrow();
	expect(() => observer.txEnd(live, new Error("original"))).not.toThrow();
	expect(() =>
		observer.snapshotRaw("TEST", {
			exists: () => false,
			get: () => undefined,
			metadata: { hasPendingWrites: false, fromCache: false },
		}),
	).not.toThrow();
	expect(() => observer.listener("TEST", "unsubscribe", "one")).not.toThrow();
	expect(fail).toHaveBeenCalledTimes(5);
});

it("measures atomic batches without inventing transaction reads or retries", () => {
	let time = 20;
	vi.spyOn(performance, "now").mockImplementation(() => time);
	const write = telemetrySyncObserver.batchStart(
		createTestOnlineGameState(),
		"TEST",
	);
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.start",
		expect.objectContaining({
			write_mode: "batch",
			room_code: "TEST",
			write_id: write.id,
		}),
	);
	time = 70;
	telemetrySyncObserver.batchEnd(write);
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.result",
		expect.objectContaining({
			write_mode: "batch",
			ok: true,
			ms_commit: 50,
			error_code: null,
		}),
	);
	const result = vi.mocked(track).mock.calls.at(-1)![1];
	for (const field of [
		"transaction_id",
		"attempts",
		"ms_get_game",
		"ms_get_room",
		"ms_tx_total",
	])
		expect(result).not.toHaveProperty(field);
	telemetrySyncObserver.batchEnd(write, { code: "permission-denied" });
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.result",
		expect.objectContaining({ ok: false, error_code: "permission-denied" }),
	);
});
it("isolates throwing batch observers on both sides of the write", () => {
	const fail = () => {
		throw new Error("observer");
	};
	const startFails = isolateSyncObserver({
		...noopSyncObserver,
		batchStart: fail,
	});
	expect(startFails.batchStart(createTestOnlineGameState(), "TEST")).toBeNull();
	expect(() => startFails.batchEnd(null)).not.toThrow();
	const endFails = isolateSyncObserver({ ...noopSyncObserver, batchEnd: fail });
	expect(() =>
		endFails.batchEnd(endFails.batchStart(createTestOnlineGameState(), "TEST")),
	).not.toThrow();
});
