import type { GameState } from "../../types";
import { track } from "./core";
import { stateFields } from "./gameplay";
interface Inputs {
	browser: boolean;
	rtdb: boolean;
	opponent: boolean;
}
const rooms = new Map<string, { inputs: Inputs; state: GameState | null }>();
function emit(room: string, inputs: Inputs, state: GameState | null) {
	const fields = state
		? stateFields(state)
		: { game_round: null, sync_version: null };
	track("mm.conn.input", {
		...fields,
		room_code: room,
		source: "browser",
		value: inputs.browser,
	});
	track("mm.conn.input", {
		...fields,
		room_code: room,
		source: "rtdb",
		value: inputs.rtdb,
	});
	track("mm.conn.input", {
		...fields,
		room_code: room,
		source: "opponent",
		value: inputs.opponent,
	});
	track("mm.conn.ready", {
		...fields,
		room_code: room,
		ready: inputs.browser && inputs.rtdb && inputs.opponent,
		browser_online: inputs.browser,
		rtdb_connected: inputs.rtdb,
		opponent_connected: inputs.opponent,
	});
}
export function connectionInputs(
	room: string,
	browser: boolean,
	rtdb: boolean,
	opponent: boolean,
) {
	if (!room) return;
	const inputs = { browser, rtdb, opponent };
	const state = rooms.get(room)?.state ?? null;
	rooms.set(room, { inputs, state });
	emit(room, inputs, state);
}
export function connectionRound(room: string | undefined, state: GameState) {
	if (!room) return;
	const data = rooms.get(room);
	if (!data) return;
	const previous = data.state;
	data.state = state;
	if (
		!previous ||
		stateFields(previous).game_round !== stateFields(state).game_round ||
		previous.gameStatus !== state.gameStatus
	)
		emit(room, data.inputs, state);
}
export function releaseConnection(room: string) {
	rooms.delete(room);
}

export function connectionSignal(
	room: string | null,
	source: "browser" | "rtdb" | "opponent",
	value: boolean,
) {
	if (!room) return;
	const data = rooms.get(room);
	const fields = data?.state
		? stateFields(data.state)
		: { game_round: null, sync_version: null };
	track("mm.conn.input", {
		...fields,
		room_code: room,
		source,
		value,
		observation: "signal",
	});
}
