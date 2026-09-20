import { snapshotGate, writeDropped } from "../services/telemetry/gameplay";
import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGameSynchronization } from "./useGameSynchronization";
import { createCardSet, createTestOnlineGameState } from "../test/testUtils";
import type { GameState, OnlineGameState } from "../types";
import type { ISyncAdapter } from "../services/sync/ISyncAdapter";

vi.mock("../services/telemetry/gameplay", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/telemetry/gameplay")>();
	return {
		...actual,
		snapshotGate: vi.fn(actual.snapshotGate),
		writeDropped: vi.fn(actual.writeDropped),
	};
});
beforeEach(() => vi.clearAllMocks());
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function setup(slot = 1) {
	const initial = createTestOnlineGameState({
		cards: createCardSet(2),
		gameRound: 2,
		syncVersion: 4,
	});
	let deliver!: (state: GameState) => void;
	let fail!: (error: Error) => void;
	const unsubscribe = vi.fn();
	const adapter = {
		subscribeToState: vi.fn(
			(
				callback: (state: GameState) => void,
				onError: (error: Error) => void,
			) => {
				deliver = callback;
				fail = onError;
				return unsubscribe;
			},
		),
		setState: vi
			.fn<(state: GameState) => Promise<void>>()
			.mockResolvedValue(undefined),
		getState: vi
			.fn<() => Promise<GameState | null>>()
			.mockResolvedValue(initial),
	};
	const hook = renderHook(
		({ room, ready, player, online }) => {
			const [state, setState] = useState<GameState>(initial);
			const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
			const checking = useRef(false);
			const sync = useGameSynchronization({
				isOnlineMode: online,
				syncAdapter: adapter as unknown as ISyncAdapter,
				roomCode: room,
				localPlayerSlot: player,
				onlineReady: ready,
				gameState: state,
				initialGameState: initial,
				setGameState: setState,
				matchCheckTimeoutRef: timer,
				isCheckingMatchRef: checking,
			});
			return { state, ...sync };
		},
		{ initialProps: { room: "TEST", ready: true, player: slot, online: true } },
	);
	return {
		...hook,
		initial,
		adapter,
		unsubscribe,
		deliver: (s: OnlineGameState) => act(() => deliver(s)),
		fail: (e: Error) => act(() => fail(e)),
	};
}

describe("synchronization sessions", () => {
	it("preserves the initial revision and ignores duplicates and stale snapshots", () => {
		const h = setup();
		h.deliver({
			...h.initial,
			syncVersion: 3,
			currentPlayer: 2,
			lastUpdatedBy: 2,
		});
		h.deliver({ ...h.initial, currentPlayer: 2, lastUpdatedBy: 2 });
		expect(h.result.current.state).toEqual(h.initial);
		h.deliver({
			...h.initial,
			syncVersion: 5,
			currentPlayer: 2,
			lastUpdatedBy: 2,
		});
		expect(h.result.current.state.currentPlayer).toBe(2);
	});
	it("serializes rapid writes and confirms echoes without rolling back optimistic revisions", async () => {
		const h = setup();
		const first = deferred<void>();
		h.adapter.setState.mockReturnValueOnce(first.promise);
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			h.result.current.syncToFirestore(h.initial);
		});
		expect(h.adapter.setState).toHaveBeenCalledTimes(1);
		h.deliver({ ...h.initial, syncVersion: 5, lastUpdatedBy: 1 });
		expect(h.result.current.localVersionRef.current).toBe(6);
		await act(async () => first.resolve());
		expect(
			h.adapter.setState.mock.calls.map(
				([s]) => (s as OnlineGameState).syncVersion,
			),
		).toEqual([5, 6]);
	});
	it("accepts a newer state from another tab using the same player identity", () => {
		const h = setup();
		h.deliver({
			...h.initial,
			syncVersion: 7,
			lastUpdatedBy: 1,
			currentPlayer: 2,
		});
		expect(h.result.current.state.currentPlayer).toBe(2);
	});
	it("invalidates queued writes when a new round arrives", async () => {
		const h = setup();
		const first = deferred<void>();
		h.adapter.setState.mockReturnValueOnce(first.promise);
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			h.result.current.syncToFirestore(h.initial);
		});
		h.deliver({ ...h.initial, gameRound: 3, syncVersion: 1, lastUpdatedBy: 1 });
		await act(async () => first.reject(new Error("old round rejected")));
		expect(h.adapter.setState).toHaveBeenCalledTimes(1);
		expect(h.result.current.syncError).toBeNull();
		expect(h.result.current.lastGameRoundRef.current).toBe(3);
	});
	it("subscription errors pause and cancel queued writes until confirmed resynchronization", async () => {
		const h = setup();
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			h.fail(new Error("Permission denied"));
		});
		expect(h.adapter.setState).not.toHaveBeenCalled();
		expect(h.result.current.syncError).toBe("Permission denied");
		await act(async () => h.result.current.resynchronize());
		expect(h.result.current.pausedRef.current).toBe(false);
	});
	it("keeps a failed or missing server read paused", async () => {
		const h = setup();
		h.adapter.getState.mockResolvedValueOnce(null);
		await act(async () => h.result.current.resynchronize());
		expect(h.result.current.syncError).toBe("Game is unavailable");
		h.adapter.getState.mockRejectedValueOnce("network error");
		await act(async () => h.result.current.resynchronize());
		expect(h.result.current.syncError).toBe("Synchronization failed");
		expect(h.result.current.pausedRef.current).toBe(true);
	});
	it("ignores stale resynchronization responses and errors after room changes", async () => {
		const h = setup();
		const stale = deferred<GameState | null>();
		h.adapter.getState.mockReturnValueOnce(stale.promise);
		let reading!: Promise<void>;
		act(() => {
			reading = h.result.current.resynchronize();
		});
		h.rerender({ room: "NEXT", ready: true, player: 1, online: true });
		const next = { ...h.initial, gameRound: 1, syncVersion: 1 };
		h.deliver(next);
		await act(async () => {
			stale.resolve(h.initial);
			await reading;
		});
		expect(h.result.current.state).toEqual(next);
		const rejected = deferred<GameState | null>();
		h.adapter.getState.mockReturnValueOnce(rejected.promise);
		act(() => {
			reading = h.result.current.resynchronize();
		});
		h.unmount();
		await act(async () => {
			rejected.reject(new Error("stale failure"));
			await reading;
		});
		expect(h.unsubscribe).toHaveBeenCalledTimes(2);
	});
	it("waits for a real player slot before subscribing and has no network effects locally", async () => {
		const h = setup(0);
		expect(h.adapter.subscribeToState).not.toHaveBeenCalled();
		h.rerender({ room: "TEST", ready: true, player: 2, online: true });
		expect(h.adapter.subscribeToState).toHaveBeenCalledTimes(1);
		h.rerender({ room: "", ready: true, player: 2, online: false });
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			await h.result.current.resynchronize();
		});
		expect(h.adapter.getState).not.toHaveBeenCalled();
		expect(h.adapter.setState).not.toHaveBeenCalled();
	});
	it("drops subsequent writes when a non-Error rejection pauses the queue", async () => {
		const h = setup();
		h.adapter.setState.mockRejectedValueOnce("offline");
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			h.result.current.syncToFirestore(h.initial);
		});
		expect(h.adapter.setState).toHaveBeenCalledTimes(1);
		expect(h.result.current.syncError).toBe("Synchronization failed");
	});
});

it("resumes from a confirmed snapshot that arrives during an in-flight resynchronization", async () => {
	const h = setup();
	const reading = deferred<GameState | null>();
	h.adapter.getState.mockReturnValueOnce(reading.promise);
	let request!: Promise<void>;
	act(() => {
		request = h.result.current.resynchronize();
	});
	const confirmed = {
		...h.initial,
		syncVersion: 5,
		currentPlayer: 2,
		lastUpdatedBy: 2,
	};
	h.deliver(confirmed);
	await act(async () => {
		reading.resolve(h.initial);
		await request;
	});
	expect(h.result.current.state).toEqual(confirmed);
	expect(h.result.current.pausedRef.current).toBe(false);
});

it("records accepted versus ignored snapshots and queued epoch drops", async () => {
	const h = setup();
	h.deliver({ ...h.initial, gameRound: 1 });
	expect(snapshotGate).toHaveBeenLastCalledWith(
		expect.anything(),
		"stale-round",
		2,
		4,
	);
	h.deliver({ ...h.initial, syncVersion: 5, lastUpdatedBy: 2 });
	expect(snapshotGate).toHaveBeenLastCalledWith(
		expect.anything(),
		"accepted",
		2,
		4,
	);
	const first = deferred<void>();
	h.adapter.setState.mockReturnValueOnce(first.promise);
	await act(async () => {
		h.result.current.syncToFirestore(h.initial, "first");
		h.result.current.syncToFirestore(h.initial, "second");
	});
	h.rerender({ room: "TEST", ready: false, player: 1, online: true });
	await act(async () => first.resolve());
	expect(writeDropped).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			fields: expect.objectContaining({ context: "second" }),
		}),
		expect.any(Number),
		true,
	);
	h.unmount();
});
