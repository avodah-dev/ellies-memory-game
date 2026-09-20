import { beforeEach, expect, it, vi } from "vitest";
import { createCardSet, createTestOnlineGameState } from "../../test/testUtils";
import { beginInput, getContext, track } from "./core";
import {
	classifyFlipRejection,
	trackCardClick,
	trackPointer,
	createSyncTrace,
	writeEnqueued,
	writeDequeued,
	writeDropped,
	timerStart,
	timerCancel,
	timerFire,
	stateFields,
	rememberState,
} from "./gameplay";
vi.mock("./core", () => ({
	track: vi.fn(),
	beginInput: vi.fn(() => "input-1"),
	currentInputId: () => "input-1",
	getContext: vi.fn(() => ({ room_code: "AAAA" })),
}));
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getContext).mockReturnValue({ room_code: "AAAA" } as ReturnType<
		typeof getContext
	>);
});
const state = () =>
	createTestOnlineGameState({
		cards: createCardSet(2),
		gameStatus: "playing",
		gameRound: 3,
		syncVersion: 7,
	});
it("reports the queued revision of optimistic cards without changing the game state", () => {
	const s = state();
	const queued = { ...s, syncVersion: 8 };
	rememberState(queued);
	expect(stateFields(s)).toMatchObject({ game_round: 3, sync_version: 8 });
	expect(s.syncVersion).toBe(7);
	// A new round owns its explicit revision even if it reuses card objects.
	const replay = { ...s, gameRound: 4, syncVersion: 1 };
	expect(stateFields(replay)).toMatchObject({
		game_round: 4,
		sync_version: 1,
	});
});
it("classifies each engine rejection without changing state", () => {
	const s = state(),
		id = s.cards[0].id;
	expect(classifyFlipRejection(s, id)).toBe("accepted");
	expect(classifyFlipRejection({ ...s, gameStatus: "setup" }, id)).toBe(
		"not-playing",
	);
	expect(classifyFlipRejection(s, "missing")).toBe("missing-card");
	expect(
		classifyFlipRejection(
			{ ...s, cards: s.cards.map((c, i) => ({ ...c, isFlipped: i === 0 })) },
			id,
		),
	).toBe("already-flipped");
	expect(
		classifyFlipRejection(
			{ ...s, cards: s.cards.map((c, i) => ({ ...c, isMatched: i === 0 })) },
			id,
		),
	).toBe("already-matched");
	expect(
		classifyFlipRejection(
			{ ...s, cards: s.cards.map((c, i) => ({ ...c, isFlipped: i < 2 })) },
			id,
		),
	).toBe("two-selected");
	expect(s.cards[0].isFlipped).toBe(false);
});
it("correlates touch down/up/click and distinguishes cancelled/keyboard activations", () => {
	const target = new EventTarget(),
		event = { currentTarget: target, pointerId: 4, pointerType: "touch" };
	trackPointer("card-0", "down", event);
	trackPointer("card-0", "up", event);
	trackCardClick("card-0", {
		currentTarget: target,
		detail: 1,
		nativeEvent: { pointerId: 4, pointerType: "touch" } as PointerEvent,
	});
	const calls = vi.mocked(track).mock.calls;
	expect(calls[0][1]).toMatchObject({ phase: "down", pointer_type: "touch" });
	expect(calls[2][1]).toMatchObject({
		gesture_id: (calls[0][1] as { gesture_id: string }).gesture_id,
		pointer_type: "touch",
		ms_down_to_click: expect.any(Number),
	});
	trackPointer("card-0", "down", event);
	trackPointer("card-0", "cancel", event);
	trackCardClick("card-0", {
		currentTarget: target,
		detail: 0,
		nativeEvent: {} as MouseEvent,
	});
	expect(vi.mocked(track).mock.lastCall?.[1]).toMatchObject({
		gesture_id: null,
		pointer_type: "keyboard",
		ms_down_to_click: null,
	});
	expect(beginInput).toHaveBeenCalledTimes(2);
});
it("keeps queue identity and differentiates epoch and pause drops", () => {
	const sync = createSyncTrace(),
		s = state();
	const first = writeEnqueued(sync, s, "flip:card-0", 2);
	const second = writeEnqueued(
		sync,
		{ ...s, syncVersion: 8 },
		"flip:card-1",
		2,
	);
	writeDequeued(sync, first);
	writeDropped(sync, second, 3, true);
	expect(sync.depth).toBe(0);
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.dropped",
		expect.objectContaining({
			write_id: second.id,
			reason: "epoch",
			paused: true,
			sync_version: 8,
			game_round: 3,
			input_id: "input-1",
		}),
	);
	const third = writeEnqueued(
		sync,
		{ ...s, syncVersion: 9 },
		"match:complete",
		3,
	);
	writeDropped(sync, third, 3, true);
	expect(track).toHaveBeenLastCalledWith(
		"mm.sync.write.dropped",
		expect.objectContaining({ reason: "pause" }),
	);
});
it("keeps timer cancellation distinct from post-fire cleanup", () => {
	const timer = timerStart("results", state(), 1200);
	timerCancel(timer, "effect-cleanup");
	timerCancel(timer, "again");
	expect(
		vi.mocked(track).mock.calls.filter((c) => c[0] === "mm.nav.results_timer"),
	).toHaveLength(2);
	const second = timerStart("results", state(), 1200);
	timerFire(second);
	timerCancel(second, "cleanup");
	expect(track).toHaveBeenLastCalledWith(
		"mm.nav.results_timer",
		expect.objectContaining({ phase: "fired", delay_ms: 1200 }),
	);
	expect(stateFields(state())).toMatchObject({
		game_round: 3,
		sync_version: 7,
	});
});
it("keeps the original room on delayed queue and timer records after leaving", () => {
	const s = state();
	const queue = createSyncTrace();
	const write = writeEnqueued(queue, s, "flip:card-0", 1);
	const timer = timerStart("results", s, 1200);
	vi.mocked(getContext).mockReturnValue({ room_code: "BBBB" } as ReturnType<
		typeof getContext
	>);
	writeDropped(queue, write, 2, false);
	timerCancel(timer, "room-change");
	for (const event of ["mm.sync.write.dropped", "mm.nav.results_timer"]) {
		const row = vi
			.mocked(track)
			.mock.calls.filter(([name]) => name === event)
			.at(-1);
		expect(row?.[1]).toMatchObject({ room_code: "AAAA" });
	}
});
