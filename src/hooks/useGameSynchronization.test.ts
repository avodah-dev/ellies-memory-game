import { snapshotGate } from "../services/telemetry/gameplay";
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
	return { ...actual, snapshotGate: vi.fn(actual.snapshotGate) };
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
function setup(
	slot = 1,
	initial = createTestOnlineGameState({
		cards: createCardSet(2),
		gameRound: 2,
		syncVersion: 4,
	}),
) {
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
	const props = {
		room: "TEST",
		ready: true,
		player: slot,
		online: true,
		uid: "user-1",
		adapter: adapter as unknown as ISyncAdapter,
	};
	const hook = renderHook(
		({ room, ready, player, online, uid, adapter: syncAdapter }) => {
			const [state, setState] = useState<GameState>(initial);
			const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
			const checking = useRef(false);
			const sync = useGameSynchronization({
				isOnlineMode: online,
				syncAdapter,
				roomCode: room,
				localPlayerSlot: player,
				localUserId: uid,
				onlineReady: ready,
				gameState: state,
				initialGameState: initial,
				setGameState: setState,
				matchCheckTimeoutRef: timer,
				isCheckingMatchRef: checking,
			});
			return { state, timer, checking, ...sync };
		},
		{ initialProps: props },
	);
	return {
		...hook,
		initial,
		adapter,
		props,
		unsubscribe,
		deliver: (s: OnlineGameState) => act(() => deliver(s)),
		fail: (e: Error) => act(() => fail(e)),
	};
}

describe("optimistic synchronization sessions", () => {
	it("preserves initial revision and filters duplicate and stale snapshots", () => {
		const h = setup();
		h.deliver({ ...h.initial, gameRound: 1, syncVersion: 99 });
		expect(snapshotGate).toHaveBeenLastCalledWith(
			expect.anything(),
			"stale-round",
			2,
			4,
		);
		h.deliver({ ...h.initial, syncVersion: 3, currentPlayer: 2 });
		h.deliver({ ...h.initial, currentPlayer: 2 });
		expect(h.result.current.state).toEqual(h.initial);
		h.deliver({
			...h.initial,
			syncVersion: 5,
			currentPlayer: 2,
			lastUpdatedBy: 2,
		});
		expect(h.result.current.state.currentPlayer).toBe(2);
	});
	it("submits every rapid revision before any acknowledgement and never rolls back on older echoes", async () => {
		const h = setup(),
			first = deferred<void>(),
			second = deferred<void>();
		h.adapter.setState
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		act(() => {
			h.result.current.syncToFirestore(h.initial);
			h.result.current.syncToFirestore(h.initial);
		});
		expect(
			h.adapter.setState.mock.calls.map(
				([s]) => (s as OnlineGameState).syncVersion,
			),
		).toEqual([5, 6]);
		h.deliver({ ...h.initial, syncVersion: 5, lastUpdatedBy: 1 });
		expect(snapshotGate).toHaveBeenLastCalledWith(
			expect.anything(),
			"self-echo",
			2,
			4,
		);
		expect(h.result.current.localVersionRef.current).toBe(6);
		expect(h.result.current.state).toEqual(h.initial); // hook never applies its own echo
		await act(async () => {
			first.resolve();
			second.resolve();
		});
		h.deliver({ ...h.initial, syncVersion: 6, lastUpdatedBy: 1 });
		expect(h.result.current.localVersionRef.current).toBe(6);
		expect(h.adapter.getState).not.toHaveBeenCalled();
	});
	it("coalesces cascading rejections into one read after ALL submitted writes settle", async () => {
		const h = setup(),
			one = deferred<void>(),
			two = deferred<void>(),
			three = deferred<void>();
		const read = deferred<GameState | null>();
		h.adapter.setState
			.mockReturnValueOnce(one.promise)
			.mockReturnValueOnce(two.promise)
			.mockReturnValueOnce(three.promise);
		h.adapter.getState.mockReturnValueOnce(read.promise);
		act(() => {
			for (let i = 0; i < 3; i++) h.result.current.syncToFirestore(h.initial);
		});
		await act(async () => one.reject(new Error("Denied")));
		expect(h.result.current.pausedRef.current).toBe(true);
		expect(h.result.current.syncError).toBe("Denied");
		expect(h.adapter.getState).not.toHaveBeenCalled();
		const later = { ...h.initial, syncVersion: 7, lastUpdatedBy: 1 };
		h.deliver(later); // an intermediate snapshot must not resume input
		h.deliver({ ...h.initial, syncVersion: 6 });
		act(() => h.result.current.syncToFirestore(h.initial));
		expect(h.adapter.setState).toHaveBeenCalledTimes(3);
		expect(h.result.current.pausedRef.current).toBe(true);
		await act(async () => two.reject(new Error("Dependent revision denied")));
		expect(h.adapter.getState).not.toHaveBeenCalled();
		// Another writer can fill the missing revisions, making a later proposal legal.
		await act(async () => three.resolve());
		expect(h.adapter.getState).toHaveBeenCalledTimes(1);
		let a!: Promise<void>, b!: Promise<void>;
		act(() => {
			a = h.result.current.resynchronize();
			b = h.result.current.resynchronize();
		});
		expect(a).toBe(b);
		await act(async () => {
			read.resolve(h.initial);
			await a;
		});
		expect(h.result.current.state).toEqual(later);
		expect(h.result.current.localVersionRef.current).toBe(7);
		expect(h.result.current.pausedRef.current).toBe(false);
		expect(h.adapter.setState).toHaveBeenCalledTimes(3); // no intent replay
		expect(h.adapter.getState).toHaveBeenCalledTimes(1);
	});
	it("detects a same-slot same-revision different-payload conflict", async () => {
		const h = setup(),
			pending = deferred<void>();
		h.adapter.setState.mockReturnValueOnce(pending.promise);
		act(() => h.result.current.syncToFirestore(h.initial));
		const competing = {
			...h.initial,
			syncVersion: 5,
			lastUpdatedBy: 1,
			cards: h.initial.cards.map((c, i) => ({ ...c, isFlipped: i === 1 })),
		};
		h.deliver(competing);
		expect(snapshotGate).toHaveBeenLastCalledWith(
			expect.anything(),
			"conflict",
			2,
			4,
		);
		expect(h.result.current.pausedRef.current).toBe(true);
		expect(h.adapter.getState).not.toHaveBeenCalled();
		h.adapter.getState.mockResolvedValueOnce(competing);
		await act(async () => pending.reject(new Error("permission-denied")));
		expect(h.result.current.state).toEqual(competing);
		expect(h.adapter.getState).toHaveBeenCalledTimes(1);
	});
	it("accepts a newer state from the same identity with no outstanding proposal", () => {
		const h = setup();
		h.deliver({
			...h.initial,
			syncVersion: 7,
			lastUpdatedBy: 1,
			currentPlayer: 2,
		});
		expect(h.result.current.state.currentPlayer).toBe(2);
	});
	it("keeps rejection handlers alive across an accepted peer snapshot", async () => {
		const h = setup(),
			pending = deferred<void>();
		h.adapter.setState.mockReturnValueOnce(pending.promise);
		act(() => h.result.current.syncToFirestore(h.initial));
		const remote = {
			...h.initial,
			syncVersion: 6,
			currentPlayer: 2,
			lastUpdatedBy: 2,
		};
		h.deliver(remote);
		h.adapter.getState.mockResolvedValue(remote);
		await act(async () => pending.reject(new Error("conflict")));
		expect(h.adapter.getState).toHaveBeenCalledTimes(1);
		expect(h.result.current.state).toEqual(remote);
	});
	it("does not mistake old-round outcomes for new-round errors", async () => {
		const h = setup(),
			first = deferred<void>(),
			second = deferred<void>();
		h.adapter.setState
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		act(() => {
			h.result.current.syncToFirestore(h.initial);
			h.result.current.syncToFirestore(h.initial);
		});
		h.deliver({ ...h.initial, gameRound: 3, syncVersion: 1 });
		await act(async () => {
			first.reject(new Error("old round"));
			second.resolve();
		});
		expect(h.result.current.syncError).toBeNull();
		expect(h.result.current.lastGameRoundRef.current).toBe(3);
		expect(h.result.current.localVersionRef.current).toBe(1);
		expect(h.adapter.getState).not.toHaveBeenCalled();
	});
	it("pauses on listener errors without pretending already-submitted writes were cancelled", async () => {
		const h = setup(),
			pending = deferred<void>();
		h.adapter.setState.mockReturnValueOnce(pending.promise);
		act(() => h.result.current.syncToFirestore(h.initial));
		h.fail(new Error("Permission denied"));
		act(() => h.result.current.syncToFirestore(h.initial));
		expect(h.adapter.setState).toHaveBeenCalledTimes(1);
		expect(h.result.current.syncError).toBe("Permission denied");
		let reading!: Promise<void>;
		act(() => {
			reading = h.result.current.resynchronize();
		});
		await act(async () => {
			pending.resolve();
			await reading;
		});
		expect(h.result.current.pausedRef.current).toBe(false);
	});
	it("keeps failed or missing reads paused until explicit retry", async () => {
		const h = setup();
		h.adapter.getState.mockResolvedValueOnce(null);
		await act(async () => h.result.current.resynchronize());
		expect(h.result.current.syncError).toBe("Game is unavailable");
		h.deliver({ ...h.initial, syncVersion: 5 });
		expect(h.result.current.pausedRef.current).toBe(true);
		h.adapter.getState.mockRejectedValueOnce("network error");
		await act(async () => h.result.current.resynchronize());
		expect(h.result.current.syncError).toBe("Synchronization failed");
		expect(h.adapter.getState).toHaveBeenCalledTimes(2);
		await act(async () => h.result.current.resynchronize());
		expect(h.result.current.pausedRef.current).toBe(false);
	});
	it.each(["room", "uid", "player", "adapter", "online"] as const)(
		"invalidates writes and old listener callbacks on %s changes",
		async (key) => {
			const h = setup(),
				pending = deferred<void>();
			h.adapter.setState.mockReturnValueOnce(pending.promise);
			const [oldSnapshot, oldError] = h.adapter.subscribeToState.mock.calls[0];
			act(() => h.result.current.syncToFirestore(h.initial));
			const values = {
				room: "NEXT",
				uid: "new-user",
				player: 2,
				adapter: { ...h.props.adapter },
				online: false,
			};
			h.rerender({ ...h.props, [key]: values[key] });
			act(() => {
				oldSnapshot({ ...h.initial, syncVersion: 999 } as OnlineGameState);
				oldError(new Error("old listener"));
			});
			await act(async () => pending.reject(new Error("stale rejection")));
			expect(h.result.current.syncError).toBeNull();
			expect(h.result.current.localVersionRef.current).toBe(0);
			expect(h.result.current.state).toEqual(h.initial);
			expect(h.adapter.getState).not.toHaveBeenCalled();
		},
	);
	it("abandons recovery before reading if its session ends while writes settle", async () => {
		const h = setup(),
			pending = deferred<void>();
		h.adapter.setState.mockReturnValueOnce(pending.promise);
		act(() => h.result.current.syncToFirestore(h.initial));
		let reading!: Promise<void>;
		act(() => {
			reading = h.result.current.resynchronize();
		});
		h.unmount();
		await act(async () => {
			pending.resolve();
			await reading;
		});
		expect(h.adapter.getState).not.toHaveBeenCalled();
	});
	it.each(["resolve", "reject"] as const)(
		"ignores stale in-flight server read %s after unmount",
		async (outcome) => {
			const h = setup(),
				read = deferred<GameState | null>();
			h.adapter.getState.mockReturnValueOnce(read.promise);
			let reading!: Promise<void>;
			await act(async () => {
				reading = h.result.current.resynchronize();
			});
			expect(h.adapter.getState).toHaveBeenCalledTimes(1);
			h.unmount();
			await act(async () => {
				if (outcome === "resolve") read.resolve(h.initial);
				else read.reject(new Error("old failure"));
				await reading;
			});
			expect(h.unsubscribe).toHaveBeenCalledTimes(1);
		},
	);
	it("waits for a valid slot and has no network effects in local mode or without an adapter/room", async () => {
		const h = setup(0);
		expect(h.adapter.subscribeToState).not.toHaveBeenCalled();
		h.rerender({ ...h.props, player: 2 });
		expect(h.adapter.subscribeToState).toHaveBeenCalledTimes(1);
		h.rerender({ ...h.props, room: "", online: false });
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			await h.result.current.resynchronize();
		});
		h.rerender({ ...h.props, adapter: undefined as unknown as ISyncAdapter });
		await act(async () => {
			h.result.current.syncToFirestore(h.initial);
			await h.result.current.resynchronize();
		});
		h.rerender({ ...h.props, room: "" });
		await act(async () => h.result.current.resynchronize());
		expect(h.adapter.setState).not.toHaveBeenCalled();
		expect(h.adapter.getState).not.toHaveBeenCalled();
	});
	it("handles synchronous and non-Error rejection without a retry storm", async () => {
		const h = setup(),
			read = deferred<GameState | null>();
		h.adapter.getState.mockReturnValueOnce(read.promise);
		h.adapter.setState.mockImplementationOnce(() => {
			throw "offline";
		});
		await act(async () => h.result.current.syncToFirestore(h.initial));
		expect(h.result.current.syncError).toBe("Synchronization failed");
		expect(h.adapter.getState).toHaveBeenCalledTimes(1);
		await act(async () => read.resolve(h.initial));
		expect(h.result.current.pausedRef.current).toBe(false);
	});
	it("waits for reconnect writes and does not resume if connectivity drops during the read", async () => {
		const h = setup(),
			pending = deferred<void>(),
			read = deferred<GameState | null>();
		h.adapter.setState.mockReturnValueOnce(pending.promise);
		h.adapter.getState.mockReturnValueOnce(read.promise);
		act(() => h.result.current.syncToFirestore(h.initial));
		h.rerender({ ...h.props, ready: false });
		expect(h.result.current.pausedRef.current).toBe(true);
		h.rerender({ ...h.props, ready: true });
		await act(async () => {});
		expect(h.adapter.getState).not.toHaveBeenCalled();
		await act(async () => pending.resolve());
		expect(h.adapter.getState).toHaveBeenCalledTimes(1);
		h.rerender({ ...h.props, ready: false });
		await act(async () => read.resolve(h.initial));
		expect(h.result.current.pausedRef.current).toBe(true);
		h.deliver({ ...h.initial, syncVersion: 7 });
		expect(h.result.current.pausedRef.current).toBe(true);
		h.rerender({ ...h.props, ready: true });
		await act(async () => {});
		expect(h.result.current.pausedRef.current).toBe(false);
		expect(h.adapter.setState).toHaveBeenCalledTimes(1);
	});
	it("replaces committed lifecycle revisions and clears a scheduled resolution", () => {
		const h = setup();
		const timer = setTimeout(() => {}, 10000);
		h.result.current.timer.current = timer;
		h.result.current.checking.current = true;
		act(() =>
			h.result.current.replaceRevision({
				...h.initial,
				gameRound: 3,
				syncVersion: 1,
			} as OnlineGameState),
		);
		expect(h.result.current.lastGameRoundRef.current).toBe(3);
		expect(h.result.current.localVersionRef.current).toBe(1);
		expect(h.result.current.timer.current).toBeNull();
		expect(h.result.current.checking.current).toBe(false);
		const {
			gameRound: _round,
			syncVersion: _version,
			...setupState
		} = h.initial;
		void _round;
		void _version;
		act(() => h.result.current.replaceRevision(setupState));
		expect(h.result.current.lastGameRoundRef.current).toBe(0);
		expect(h.result.current.localVersionRef.current).toBe(0);
	});
});
