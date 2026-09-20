import type { RuntimeConfig } from "../../../shared/runtimeConfig";

export interface EventProps {
	"mm.session.start": Record<string, string | number | boolean | null>;
	"mm.app.boot": { phase: string; ms_elapsed: number };
	"mm.app.error": {
		source: "error" | "unhandledrejection";
		error_type: string;
	};
	"mm.app.visibility": { state: string };
	"mm.nav.route": { path: string };
	"mm.telemetry.health": {
		dropped: number;
		invalid: number;
		queued: number;
		ms_drain: number;
		drain_ms_max: number;
		sink_dropped: number;
		sink_failures: number;
	};
	"mm.clock.offset": {
		source: "http" | "rtdb";
		offset_ms: number;
		rtt_ms: number | null;
	};
	"mm.presence.change": {
		opponent_connected: boolean;
		connection_status: string;
	};
	"mm.room.status": { status: string | null };
}
export type EventName = keyof EventProps;
export interface TelemetryContext {
	odah_id: string | null;
	room_code: string | null;
	player_slot: 1 | 2 | null;
	is_host: boolean;
	game_round: number | null;
	sync_version: number | null;
}
export interface TelemetryEvent {
	event: EventName;
	distinct_id: string;
	uuid: string;
	timestamp: string;
	properties: Record<string, unknown> & {
		device_id: string;
		device_label: string;
		page_session_id: string;
		seq: number;
		t_mono: number;
		t_wall: number;
		t_server: number | null;
		clock_reference: "rtdb" | "uncalibrated";
		environment: RuntimeConfig["environment"];
		commit: string;
		$process_person_profile: false;
		$geoip_disable: true;
	};
}

export interface PreparedEvent {
	data: TelemetryEvent;
	json: string;
	bytes: number;
}
const encoder = new TextEncoder();
export function prepareEvent(data: TelemetryEvent): PreparedEvent {
	const json = JSON.stringify(data);
	return { data, json, bytes: encoder.encode(json).length };
}
