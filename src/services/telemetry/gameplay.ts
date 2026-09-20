import type { Card, GameState, OnlineGameState } from "../../types";
import type { Detail, StateFields } from "./gameplayEvents";
import { beginInput, currentInputId, getContext, track } from "./core";
let serial = 0;
export const nextId = () => String(++serial);
export function errorCode(error: unknown): string {
	if (
		error &&
		typeof error === "object" &&
		"code" in error &&
		typeof error.code === "string"
	)
		return error.code.slice(0, 80);
	return error instanceof Error ? error.name : "unknown";
}
const revisions = new WeakMap<Card[], StateFields>();
export function stateFields(state: GameState): StateFields {
	const online = state as Partial<OnlineGameState>;
	const remembered = revisions.get(state.cards);
	return {
		game_round: online.gameRound ?? remembered?.game_round ?? null,
		sync_version: online.syncVersion ?? remembered?.sync_version ?? null,
		game_status: state.gameStatus,
		current_player: state.currentPlayer,
	};
}
export const cardFields = (cards: Card[]) =>
	revisions.get(cards) ?? {
		game_round: null,
		sync_version: null,
		game_status: "unknown",
		current_player: 0,
	};
export function rememberState(state: GameState) {
	const fields = stateFields(state);
	const previous = revisions.get(state.cards);
	if (
		previous &&
		previous.game_round === fields.game_round &&
		previous.sync_version !== null &&
		fields.sync_version !== null
	)
		fields.sync_version = Math.max(previous.sync_version, fields.sync_version);
	revisions.set(state.cards, fields);
}
export function classifyFlipRejection(
	state: GameState,
	cardId: string,
): string {
	if (state.gameStatus !== "playing") return "not-playing";
	if (state.cards.filter((c) => c.isFlipped && !c.isMatched).length >= 2)
		return "two-selected";
	const card = state.cards.find((c) => c.id === cardId);
	if (!card) return "missing-card";
	if (card.isMatched) return "already-matched";
	if (card.isFlipped) return "already-flipped";
	return "accepted";
}
let inputStarted: number | null = null;
export const inputTime = () =>
	currentInputId() === null ? null : inputStarted;
interface Gesture {
	id: string;
	at: number;
	type: string;
	cancelled: boolean;
}
const gestures = new WeakMap<EventTarget, Map<number, Gesture>>();
export function trackPointer(
	cardId: string,
	phase: "down" | "up" | "cancel",
	event: { currentTarget: EventTarget; pointerId: number; pointerType: string },
) {
	let pointers = gestures.get(event.currentTarget);
	if (!pointers) {
		pointers = new Map();
		gestures.set(event.currentTarget, pointers);
	}
	if (phase === "down") {
		if (pointers.size >= 8) pointers.clear();
		pointers.set(event.pointerId, {
			id: nextId(),
			at: performance.now(),
			type: event.pointerType,
			cancelled: false,
		});
	}
	const gesture = pointers.get(event.pointerId);
	if (gesture && phase === "cancel") gesture.cancelled = true;
	track("mm.input.pointer", {
		card_id: cardId,
		phase,
		pointer_type: event.pointerType,
		pointer_id: event.pointerId,
		gesture_id: gesture?.id ?? null,
	});
}
export function trackCardClick(
	cardId: string,
	event: {
		currentTarget: EventTarget;
		detail: number;
		nativeEvent: MouseEvent;
	},
) {
	const native = event.nativeEvent as PointerEvent;
	const pointers = gestures.get(event.currentTarget);
	const gesture =
		typeof native.pointerId === "number"
			? pointers?.get(native.pointerId)
			: pointers && pointers.size === 1
				? pointers.values().next().value
				: undefined;
	const eligible = event.detail > 0 && gesture && !gesture.cancelled;
	const id = beginInput();
	inputStarted = performance.now();
	track("mm.input.click", {
		card_id: cardId,
		input_id: id,
		gesture_id: eligible ? gesture.id : null,
		pointer_type:
			native.pointerType ||
			(eligible ? gesture.type : event.detail === 0 ? "keyboard" : "unknown"),
		ms_down_to_click: eligible ? performance.now() - gesture.at : null,
	});
	pointers?.clear();
}
export function trackFlip(
	state: GameState,
	cardId: string,
	result: string,
	paused: boolean,
	ready: boolean,
	checking: boolean,
	slot: number | undefined,
	mode: string,
) {
	track("mm.game.flip", {
		...stateFields(state),
		card_id: cardId,
		result,
		paused,
		online_ready: ready,
		checking_match: checking,
		local_slot: slot ?? null,
		mode,
	});
}
export function trackBlockedFlip(
	state: GameState,
	cardId: string,
	paused: boolean,
	ready: boolean,
	checking: boolean,
	slot: number | undefined,
	mode: string,
) {
	trackFlip(
		state,
		cardId,
		paused ? "paused" : "not-ready",
		paused,
		ready,
		checking,
		slot,
		mode,
	);
}
export function trackFinish(state: GameState) {
	track("mm.game.finish_check", {
		...stateFields(state),
		matched_count: state.cards.filter((c) => c.isMatched).length,
		card_count: state.cards.length,
		finished: state.gameStatus === "finished",
	});
}
export interface WriteTrace {
	id: string;
	at: number;
	input: string | null;
	inputAt: number | null;
	fields: Detail;
}
const writes = new WeakMap<GameState, WriteTrace>();
export function writeTrace(state: GameState): WriteTrace {
	return (
		writes.get(state) ?? {
			id: nextId(),
			at: performance.now(),
			input: currentInputId(),
			inputAt: inputTime(),
			fields: { ...getContext(), ...stateFields(state) },
		}
	);
}
export function createSyncTrace() {
	return { id: nextId(), depth: 0, pausedAt: null as number | null };
}
export type SyncTrace = ReturnType<typeof createSyncTrace>;
export function writeSkipped(
	online: boolean,
	adapter: unknown,
	paused: boolean,
	context: string | undefined,
	state: GameState,
) {
	if (!online || !adapter || paused)
		track("mm.sync.write.skipped", {
			...stateFields(state),
			reason: !online ? "local" : !adapter ? "no-adapter" : "paused",
			context: context ?? null,
		});
}
export function writeEnqueued(
	trace: SyncTrace,
	state: OnlineGameState,
	context: string | undefined,
	epoch: number,
) {
	rememberState(state);
	const value: WriteTrace = {
		id: nextId(),
		at: performance.now(),
		input: currentInputId(),
		inputAt: inputTime(),
		fields: {
			...getContext(),
			...stateFields(state),
			context: context ?? null,
			epoch,
			sync_session: trace.id,
		},
	};
	writes.set(state, value);
	track("mm.sync.write.enqueued", {
		...value.fields,
		write_id: value.id,
		input_id: value.input,
		queue_depth: ++trace.depth,
	});
	return value;
}
export function writeDequeued(trace: SyncTrace, value: WriteTrace) {
	trace.depth--;
	track("mm.sync.write.dequeued", {
		...value.fields,
		write_id: value.id,
		input_id: value.input,
		queue_depth: trace.depth,
		ms_queue_wait: performance.now() - value.at,
	});
}
export function writeDropped(
	trace: SyncTrace,
	value: WriteTrace,
	epoch: number,
	paused: boolean,
) {
	trace.depth--;
	track("mm.sync.write.dropped", {
		...value.fields,
		write_id: value.id,
		input_id: value.input,
		reason: epoch !== value.fields.epoch ? "epoch" : "pause",
		paused,
		current_epoch: epoch,
		queue_depth: trace.depth,
	});
}
export function epochBump(trace: SyncTrace, epoch: number, reason: string) {
	track("mm.sync.epoch", { sync_session: trace.id, epoch, reason });
}
export function pauseTrace(trace: SyncTrace, reason: string) {
	trace.pausedAt ??= performance.now();
	track("mm.sync.pause", { sync_session: trace.id, reason });
}
export function resumeTrace(trace: SyncTrace, reason: string) {
	track("mm.sync.resume", {
		sync_session: trace.id,
		reason,
		ms_paused:
			trace.pausedAt === null ? null : performance.now() - trace.pausedAt,
	});
	trace.pausedAt = null;
}
export function snapshotGate(
	state: GameState,
	decision: string,
	round: number,
	version: number,
) {
	track("mm.sync.snapshot.gate", {
		...stateFields(state),
		decision,
		local_round: round,
		local_version: version,
	});
}
interface Applied {
	id: string;
	at: number;
	fields: StateFields;
}
const applied = new WeakMap<Card[], Applied>();
export function stateApplied(state: GameState, source: string) {
	rememberState(state);
	const record = {
		id: nextId(),
		at: performance.now(),
		fields: { ...getContext(), ...stateFields(state) },
	};
	applied.set(state.cards, record);
	track("mm.state.applied", { ...record.fields, apply_id: record.id, source });
}
export const appliedCards = (cards: Card[]) => applied.get(cards);
export function listenerStart(layer: string, room: string | undefined) {
	const id = nextId();
	track("mm.sync.listener", {
		layer,
		room_code: room ?? null,
		listener_id: id,
		phase: "subscribe",
	});
	return id;
}
export function listenerStop(
	id: string,
	layer: string,
	room: string | undefined,
) {
	track("mm.sync.listener", {
		layer,
		room_code: room ?? null,
		listener_id: id,
		phase: "unsubscribe",
	});
}
export interface TimerTrace {
	id: string;
	at: number;
	delay: number;
	kind: "match" | "results";
	fields: Detail;
	fired: boolean;
	cancelled: boolean;
}
const matchTimers = new WeakMap<object, TimerTrace>();
export function timerStart(
	kind: "match" | "results",
	state: GameState,
	delay: number,
	owner?: object,
) {
	const timer: TimerTrace = {
		id: nextId(),
		at: performance.now(),
		delay,
		kind,
		fields: { ...getContext(), ...stateFields(state) },
		fired: false,
		cancelled: false,
	};
	if (owner) matchTimers.set(owner, timer);
	timerEvent(timer, "scheduled");
	return timer;
}
function timerEvent(
	timer: TimerTrace,
	phase: string,
	reason: string | null = null,
) {
	track(
		timer.kind === "match" ? "mm.game.match_timer" : "mm.nav.results_timer",
		{
			...timer.fields,
			timer_id: timer.id,
			phase,
			reason,
			delay_ms: timer.delay,
			ms_elapsed: performance.now() - timer.at,
		},
	);
}
export function timerFire(timer: TimerTrace) {
	timer.fired = true;
	timerEvent(timer, "fired");
}
export function timerCancel(timer: TimerTrace, reason: string) {
	if (!timer.fired && !timer.cancelled) {
		timer.cancelled = true;
		timerEvent(timer, "cancelled", reason);
	}
}
export function cancelMatchTimer(owner: object, reason: string) {
	const timer = matchTimers.get(owner);
	if (timer) timerCancel(timer, reason);
}
export function resultsNavigate(timer: TimerTrace, result: Promise<unknown>) {
	void result.then(
		() => timerEvent(timer, "navigation-resolved"),
		() => timerEvent(timer, "navigation-rejected"),
	);
	return result;
}
