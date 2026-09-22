import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	useGameController,
	type UseGameControllerOptions,
} from "./useGameController";
import {
	createCardSet,
	createTestGameState,
	createTestOnlineGameState,
	createTestSettings,
	getTestPlayers,
} from "../test/testUtils";
import type { ISyncAdapter } from "../services/sync/ISyncAdapter";
import type { GameState } from "../types";
const options = (
	overrides: Partial<UseGameControllerOptions> = {},
): UseGameControllerOptions => ({
	mode: "local",
	initialGameState: createTestGameState({ cards: createCardSet(2) }),
	initialSettings: createTestSettings({ flipDuration: 500 }),
	players: getTestPlayers(),
	...overrides,
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("game lifecycle regressions", () => {
	it("handles two clicks in one render without losing the first", () => {
		const { result } = renderHook(() => useGameController(options()));
		act(() => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-1");
		});
		expect(
			result.current.gameState.cards.filter((c) => c.isFlipped),
		).toHaveLength(2);
		act(() => vi.advanceTimersByTime(500));
		expect(
			result.current.gameState.cards.filter((c) => c.isMatched),
		).toHaveLength(2);
	});
	it("finishes the final match without a mounted animation component", () => {
		const { result } = renderHook(() =>
			useGameController(
				options({
					initialGameState: createTestGameState({ cards: createCardSet(1) }),
				}),
			),
		);
		act(() => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-1");
		});
		act(() => vi.advanceTimersByTime(500));
		expect(result.current.gameState.gameStatus).toBe("finished");
	});
	it("cancels resolution on unmount", () => {
		const { result, unmount } = renderHook(() => useGameController(options()));
		act(() => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-1");
		});
		unmount();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does not resolve a previous board after reset", () => {
		const { result } = renderHook(() => useGameController(options()));
		act(() => {
			result.current.flipCard("card-0");
			result.current.flipCard("card-1");
		});
		act(() => {
			result.current.resetGame();
			result.current.setFullGameState(
				createTestGameState({ cards: createCardSet(3) }),
			);
		});
		act(() => vi.advanceTimersByTime(5000));
		expect(
			result.current.gameState.cards.every((c) => !c.isMatched && !c.isFlipped),
		).toBe(true);
	});
	it("ignores older rounds even when they have higher versions", () => {
		let deliver: (s: GameState) => void = () => {};
		const adapter = {
			subscribeToState: (cb: (s: GameState) => void) => {
				deliver = cb;
				return () => {};
			},
			setState: vi.fn(),
			getState: vi.fn(),
		} as unknown as ISyncAdapter;
		const initial = createTestOnlineGameState({
			cards: createCardSet(2),
			gameRound: 2,
			syncVersion: 2,
		});
		const { result } = renderHook(() =>
			useGameController(
				options({
					mode: "online",
					roomCode: "TEST",
					localPlayerSlot: 1,
					initialGameState: initial,
					syncAdapter: adapter,
				}),
			),
		);
		act(() =>
			deliver({
				...initial,
				gameRound: 1,
				syncVersion: 99,
				lastUpdatedBy: 2,
			} as GameState),
		);
		expect(result.current.gameState).toEqual(initial);
		act(() =>
			deliver({
				...initial,
				gameRound: 1,
				syncVersion: 100,
				lastUpdatedBy: 1,
			} as GameState),
		);
		act(() =>
			deliver({
				...initial,
				syncVersion: 3,
				currentPlayer: 2,
				lastUpdatedBy: 2,
			} as GameState),
		);
		expect(result.current.gameState.currentPlayer).toBe(2);
	});
	it("pauses on failed writes and automatically restores confirmed state", async () => {
		const initial = createTestOnlineGameState({ cards: createCardSet(2) });
		let confirm!: (state: GameState) => void;
		const confirmed = new Promise<GameState>((resolve) => {
			confirm = resolve;
		});
		const adapter = {
			subscribeToState: () => () => {},
			setState: vi.fn().mockRejectedValue(new Error("Write denied")),
			getState: vi.fn().mockReturnValue(confirmed),
		} as unknown as ISyncAdapter;
		const { result } = renderHook(() =>
			useGameController(
				options({
					mode: "online",
					roomCode: "TEST",
					localPlayerSlot: 1,
					initialGameState: initial,
					syncAdapter: adapter,
				}),
			),
		);
		await act(async () => result.current.flipCard("card-0"));
		expect(result.current.syncError).toBe("Write denied");
		act(() => result.current.flipCard("card-1"));
		expect(result.current.gameState.cards[1].isFlipped).toBe(false);
		expect(adapter.getState).toHaveBeenCalledTimes(1);
		await act(async () => confirm(initial));
		expect(result.current.syncError).toBeNull();
		expect(result.current.gameState).toEqual(initial);
	});
	it("blocks actions while disconnected and resumes an unresolved turn", async () => {
		const initial = createTestOnlineGameState({
			cards: createCardSet(2).map((c, i) => ({ ...c, isFlipped: i < 2 })),
		});
		const adapter = {
			subscribeToState: () => () => {},
			setState: vi.fn().mockResolvedValue(undefined),
			getState: vi.fn().mockResolvedValue(initial),
		} as unknown as ISyncAdapter;
		const { result, rerender } = renderHook(
			({ ready }) =>
				useGameController(
					options({
						mode: "online",
						roomCode: "TEST",
						localPlayerSlot: 1,
						initialGameState: initial,
						syncAdapter: adapter,
						onlineReady: ready,
					}),
				),
			{ initialProps: { ready: false } },
		);
		act(() => {
			result.current.endTurn();
			vi.advanceTimersByTime(1000);
		});
		expect(result.current.gameState.currentPlayer).toBe(1);
		expect(adapter.setState).not.toHaveBeenCalled();
		await act(async () => rerender({ ready: true }));
		await act(async () => vi.advanceTimersByTime(500));
		expect(
			result.current.gameState.cards.filter((c) => c.isMatched),
		).toHaveLength(2);
	});
});
