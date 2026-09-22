import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EffectManager } from "../services/effects/EffectManager";
import type { ISyncAdapter } from "../services/sync/ISyncAdapter";
import type { GameState, OnlineGameState } from "../types";
import {
	createCardSet,
	createTestGameState,
	createTestOnlineGameState,
	createTestSettings,
	getTestPlayers,
} from "../test/testUtils";
import {
	useGameController,
	type UseGameControllerOptions,
} from "./useGameController";

const options = (
	extra: Partial<UseGameControllerOptions> = {},
): UseGameControllerOptions => ({
	mode: "local",
	initialGameState: createTestGameState({ cards: createCardSet(3) }),
	initialSettings: createTestSettings({ flipDuration: 500 }),
	players: getTestPlayers(),
	...extra,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("match-only early resolution", () => {
	it.each([false, true])(
		"accepts a third press after a match (single React batch: %s)",
		(batched) => {
			const effects = new EffectManager();
			const notify = vi.spyOn(effects, "notifyMatchFound");
			const { result } = renderHook(() =>
				useGameController(options({ effectManager: effects })),
			);
			act(() => {
				result.current.flipCard("card-0");
				result.current.flipCard("card-1");
				if (batched) result.current.flipCard("card-2");
			});
			if (!batched) act(() => result.current.flipCard("card-2"));
			expect(
				result.current.gameState.cards.slice(0, 2).every((c) => c.isMatched),
			).toBe(true);
			expect(result.current.gameState.cards[2].isFlipped).toBe(true);
			expect(result.current.gameState.currentPlayer).toBe(1);
			expect(notify).toHaveBeenCalledTimes(1);
			act(() => vi.advanceTimersByTime(500));
			expect(notify).toHaveBeenCalledTimes(1);
			expect(result.current.gameState.cards[2].isFlipped).toBe(true);
		},
	);

	it("rejects a third press throughout the full mismatch reveal without replaying it", () => {
		const { result } = renderHook(() => useGameController(options()));
		act(() => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-2");
		});
		act(() => {
			vi.advanceTimersByTime(100);
			result.current.flipCard("card-4");
		});
		act(() => {
			vi.advanceTimersByTime(399);
			result.current.flipCard("card-4");
		});
		expect(
			result.current.gameState.cards
				.filter((c) => c.isFlipped)
				.map((c) => c.id),
		).toEqual(["card-0", "card-2"]);
		expect(result.current.gameState.currentPlayer).toBe(1);
		act(() => vi.advanceTimersByTime(1));
		expect(result.current.gameState.cards.every((c) => !c.isFlipped)).toBe(
			true,
		);
		expect(result.current.gameState.currentPlayer).toBe(2);
	});

	it.each(["card-0", "card-1", "card-4", "missing"])(
		"does not resolve early for invalid target %s",
		(id) => {
			const cards = createCardSet(3).map((c, i) => ({
				...c,
				isMatched: i >= 4,
				isFlipped: i >= 4,
			}));
			const { result } = renderHook(() =>
				useGameController(
					options({ initialGameState: createTestGameState({ cards }) }),
				),
			);
			act(() => {
				result.current.flipCard("card-0");
				result.current.flipCard("card-1");
			});
			act(() => result.current.flipCard(id));
			expect(result.current.gameState.cards[0].isMatched).toBe(false);
			act(() => vi.advanceTimersByTime(500));
			expect(result.current.gameState.cards[0].isMatched).toBe(true);
		},
	);

	it.each(["setup", "finished"] as const)(
		"does not resolve an exposed pair when game is %s",
		(gameStatus) => {
			const initialGameState = createTestGameState({
				gameStatus,
				cards: createCardSet(3).map((c, i) => ({ ...c, isFlipped: i < 2 })),
			});
			const { result } = renderHook(() =>
				useGameController(options({ initialGameState })),
			);
			act(() => result.current.flipCard("card-2"));
			expect(result.current.gameState).toBe(initialGameState);
		},
	);

	it.each(["input-first", "timer-first"])(
		"resolves once at the timer boundary: %s",
		(order) => {
			const effects = new EffectManager();
			const notify = vi.spyOn(effects, "notifyMatchFound");
			const { result } = renderHook(() =>
				useGameController(options({ effectManager: effects })),
			);
			act(() => {
				result.current.flipCard("card-0");
				result.current.flipCard("card-1");
			});
			act(() => vi.advanceTimersByTime(499));
			act(() => {
				if (order === "timer-first") vi.advanceTimersByTime(1);
				result.current.flipCard("card-2");
				if (order === "input-first") vi.advanceTimersByTime(1);
			});
			expect(notify).toHaveBeenCalledTimes(1);
			expect(result.current.gameState.cards[2].isFlipped).toBe(true);
		},
	);

	it.each(["early", "reset", "replace", "unmount"])(
		"ignores an already queued stale timer after %s",
		(action) => {
			const timeouts = vi.spyOn(globalThis, "setTimeout");
			const effects = new EffectManager();
			const notify = vi.spyOn(effects, "notifyMatchFound");
			const { result, unmount } = renderHook(() =>
				useGameController(options({ effectManager: effects })),
			);
			act(() => {
				result.current.flipCard("card-0");
				result.current.flipCard("card-1");
			});
			const stale = timeouts.mock.calls.find(
				([, delay]) => delay === 500,
			)![0] as () => void;
			act(() => {
				if (action === "early") {
					result.current.flipCard("card-2");
					result.current.flipCard("card-3");
				}
				if (action === "reset") result.current.resetGame();
				if (action === "replace")
					result.current.setFullGameState(
						createTestGameState({
							cards: createCardSet(3).map((c, i) => ({
								...c,
								isFlipped: i === 2 || i === 3,
							})),
						}),
					);
			});
			if (action === "unmount") unmount();
			const before = result.current.gameState;
			const notifications = notify.mock.calls.length;
			act(() => stale());
			expect(result.current.gameState).toBe(before);
			expect(notify).toHaveBeenCalledTimes(notifications);
		},
	);

	it("submits match resolution then the new flip as distinct ordered online revisions", async () => {
		const initialGameState = createTestOnlineGameState({
			cards: createCardSet(3),
			syncVersion: 0,
			gameRound: 1,
		});
		const setState = vi.fn().mockResolvedValue(undefined);
		const syncAdapter = {
			subscribeToState: () => () => {},
			setState,
			getState: vi.fn(),
		} as unknown as ISyncAdapter;
		const { result } = renderHook(() =>
			useGameController(
				options({
					mode: "online",
					roomCode: "TEST",
					localPlayerSlot: 1,
					initialGameState,
					syncAdapter,
				}),
			),
		);
		await act(async () => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-1");
			result.current.flipCard("card-2");
		});
		const writes = setState.mock.calls.map(([s]) => s as OnlineGameState);
		expect(writes.map((s) => s.syncVersion)).toEqual([1, 2, 3, 4]);
		expect(writes[2].cards.slice(0, 2).every((c) => c.isMatched)).toBe(true);
		expect(writes[2].cards[2].isFlipped).toBe(false);
		expect(writes[3].cards[2].isFlipped).toBe(true);
		expect(
			writes.every((s) => s.currentPlayer === 1 && s.gameRound === 1),
		).toBe(true);
		await act(async () => vi.advanceTimersByTime(500));
		expect(setState).toHaveBeenCalledTimes(4);
	});

	it("coalesces match and dependent flip rejections without replaying the third press", async () => {
		const initialGameState = createTestOnlineGameState({
			cards: createCardSet(3),
			syncVersion: 0,
			gameRound: 1,
		});
		const confirmed = {
			...initialGameState,
			syncVersion: 2,
			cards: initialGameState.cards.map((c, i) => ({ ...c, isFlipped: i < 2 })),
		};
		let restore!: (state: GameState) => void;
		const reading = new Promise<GameState>((resolve) => {
			restore = resolve;
		});
		const setState = vi
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("Match denied"))
			.mockRejectedValueOnce(new Error("Dependent flip denied"));
		const syncAdapter = {
			subscribeToState: () => () => {},
			setState,
			getState: vi.fn().mockReturnValue(reading),
		} as unknown as ISyncAdapter;
		const { result, unmount } = renderHook(() =>
			useGameController(
				options({
					mode: "online",
					roomCode: "TEST",
					localPlayerSlot: 1,
					initialGameState,
					syncAdapter,
				}),
			),
		);
		await act(async () => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-1");
			result.current.flipCard("card-2");
		});
		expect(result.current.syncError).toBe("Match denied");
		expect(setState.mock.calls.map(([s]) => s.syncVersion)).toEqual([
			1, 2, 3, 4,
		]);
		act(() => {
			result.current.flipCard("card-3");
			vi.advanceTimersByTime(1000);
		});
		expect(setState).toHaveBeenCalledTimes(4);
		expect(result.current.gameState.cards[3].isFlipped).toBe(false);
		expect(syncAdapter.getState).toHaveBeenCalledTimes(1);
		await act(async () => restore(confirmed));
		expect(result.current.gameState).toEqual(confirmed);
		expect(result.current.syncError).toBeNull();
		unmount();
	});

	it.each(["opponent", "offline", "denied"])(
		"does not resolve early when %s",
		async (reason) => {
			const initialGameState = createTestOnlineGameState({
				cards: createCardSet(3).map((c, i) => ({ ...c, isFlipped: i < 2 })),
			});
			const syncAdapter = {
				subscribeToState: () => () => {},
				setState: vi.fn().mockRejectedValue(new Error("Write denied")),
				getState: vi.fn(),
			} as unknown as ISyncAdapter;
			const { result } = renderHook(() =>
				useGameController(
					options({
						mode: "online",
						roomCode: "TEST",
						localPlayerSlot: reason === "opponent" ? 2 : 1,
						onlineReady: reason !== "offline",
						initialGameState,
						syncAdapter,
					}),
				),
			);
			if (reason === "denied") await act(async () => result.current.endTurn());
			const before = result.current.gameState;
			act(() => result.current.flipCard("card-2"));
			expect(result.current.gameState).toBe(before);
		},
	);
});
