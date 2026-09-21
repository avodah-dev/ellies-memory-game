export type Scalar = string | number | boolean | null;
export interface StateFields {
	[key: string]: Scalar;
	game_round: number | null;
	sync_version: number | null;
	game_status: string;
	current_player: number;
}
export interface Detail extends Partial<StateFields> {
	[key: string]: Scalar | undefined;
}
export interface GameplayEvents {
	"mm.input.activation": Detail & {
		card_id: string;
		input_id: string;
		source: "pointerdown" | "click";
		pointer_type: string;
		gesture_id: string | null;
	};
	"mm.input.pointer": Detail & {
		card_id: string;
		phase: "down" | "up" | "cancel";
		pointer_type: string;
		pointer_id: number;
		gesture_id: string | null;
	};
	"mm.input.click": Detail & {
		card_id: string;
		pointer_type: string;
		gesture_id: string | null;
		ms_down_to_click: number | null;
	};
	"mm.game.flip": Detail & {
		card_id: string;
		result: string;
		paused: boolean;
		online_ready: boolean;
		checking_match: boolean;
	};
	"mm.game.state": Detail & { phase: string };
	"mm.game.endturn": Detail & { result: string };
	"mm.game.match": Detail & { result: string };
	"mm.game.finish_check": Detail & {
		matched_count: number;
		card_count: number;
		finished: boolean;
	};
	"mm.game.match_timer": Detail & {
		phase: string;
		timer_id: string;
		ms_elapsed: number;
		delay_ms: number;
	};
	"mm.nav.results_timer": Detail & {
		phase: string;
		timer_id: string;
		ms_elapsed: number;
		delay_ms: number;
	};
	"mm.conn.input": Detail & {
		source: "browser" | "rtdb" | "opponent";
		value: boolean;
	};
	"mm.conn.ready": Detail & {
		ready: boolean;
		browser_online: boolean;
		rtdb_connected: boolean;
		opponent_connected: boolean;
	};
	"mm.sync.write.skipped": Detail & { reason: string };
	"mm.sync.write.enqueued": Detail & { write_id: string; queue_depth: number };
	"mm.sync.write.dequeued": Detail & {
		write_id: string;
		queue_depth: number;
		ms_queue_wait: number;
	};
	"mm.sync.write.dropped": Detail & { write_id: string; reason: string };
	"mm.sync.write.start": Detail & { write_id: string; transaction_id: string };
	"mm.sync.write.result": Detail & {
		write_id: string;
		transaction_id: string;
		ok: boolean;
		attempts: number;
		ms_tx_total: number;
	};
	"mm.sync.tx.phase": Detail & {
		transaction_id: string;
		phase: string;
		attempt: number;
		ms_elapsed: number;
	};
	"mm.sync.snapshot.raw": Detail & {
		exists: boolean;
		from_cache: boolean;
		pending_writes: boolean;
		decision: string;
	};
	"mm.sync.snapshot.gate": Detail & { decision: string };
	"mm.sync.listener": Detail & {
		phase: string;
		listener_id: string;
		layer: string;
	};
	"mm.sync.pause": Detail & { reason: string };
	"mm.sync.resume": Detail & { reason: string; ms_paused: number | null };
	"mm.sync.epoch": Detail & { epoch: number; reason: string };
	"mm.sync.resync": Detail & { phase: string };
	"mm.sync.call": Detail & { method: string; phase: string; call_id: string };
	"mm.room.create": Detail;
	"mm.room.join": Detail;
	"mm.room.start": Detail;
	"mm.room.leave": Detail;
	"mm.room.reset": Detail;
	"mm.state.applied": Detail & { apply_id: string; source: string };
	"mm.render.painted": Detail & {
		apply_id: string | null;
		ms_apply_to_paint: number | null;
		phase: string;
	};
	"mm.perf.frames": Detail & { samples: number; ms_max: number };
	"mm.perf.longframe": Detail & { ms_duration: number };
	"mm.perf.longtask": Detail & { ms_duration: number; entry_type: string };
	"mm.perf.timer": Detail & { ms_drift: number };
}
