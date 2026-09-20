import type { RuntimeConfig } from "../../../shared/runtimeConfig";
import { prepareEvent } from "./events";
import { clockProperties, getOffsets, type ClockOffsets } from "./clock";
import type {
	EventName,
	EventProps,
	TelemetryContext,
	PreparedEvent,
} from "./events";
import {
	collectDeviceTraits,
	getDeviceIdentity,
	getPageSessionId,
} from "./identity";
import { selectSinks, type TelemetrySink } from "./sinks";

const CAPACITY = 3000;
type Entry = {
	name: EventName;
	props: EventProps[EventName];
	seq: number;
	mono: number;
	wall: number;
	context: TelemetryContext;
	clock: ClockOffsets;
	input: string | null;
};
const emptyContext: TelemetryContext = {
	odah_id: null,
	room_code: null,
	player_slot: null,
	is_host: false,
	game_round: null,
	sync_version: null,
};
let context = emptyContext;
const ring: (Entry | undefined)[] = new Array(CAPACITY);
let head = 0;
let length = 0;
let seq = 0;
let dropped = 0;
let invalid = 0;
let input: string | null = null;
let inputSeq = 0;
let sinks: TelemetrySink[] = [];
let config: RuntimeConfig | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let healthAt = 0;
let lastDrainMs = 0;
let maxDrainMs = 0;
export const counters = {
	cardRenders: 0,
	boardRenders: 0,
	appRenders: 0,
	modelPublishes: 0,
	cursorRx: 0,
	cursorTx: 0,
};

export function setContext(next: Partial<TelemetryContext>) {
	context = { ...context, ...next };
}
export function getContext(): Readonly<TelemetryContext> {
	return context;
}
export function beginInput(): string {
	const id = String(++inputSeq);
	input = id;
	queueMicrotask(() => {
		if (input === id) input = null;
	});
	return id;
}
export function currentInputId() {
	return input;
}
export function track<N extends EventName>(
	name: N,
	props: EventProps[N],
): void {
	// No serialization, storage, UUID generation, scheduling or network on the hot path.
	try {
		if (length === CAPACITY) {
			head = (head + 1) % CAPACITY;
			length--;
			dropped++;
		}
		ring[(head + length) % CAPACITY] = {
			name,
			props,
			seq: ++seq,
			mono: performance.now(),
			wall: Date.now(),
			context,
			clock: getOffsets(),
			input,
		};
		length++;
	} catch {
		invalid++;
	}
}
export function telemetryStats() {
	return {
		dropped,
		invalid,
		queued: length,
		ms_drain: lastDrainMs,
		drain_ms_max: maxDrainMs,
	};
}
function arm(ms: number) {
	if (timer !== undefined || !config) return;
	timer = setTimeout(() => {
		timer = undefined;
		flushNow();
	}, ms);
}
export function flushNow() {
	if (!config) return;
	clearTimeout(timer);
	timer = undefined;
	const started = performance.now();
	const batch: PreparedEvent[] = [];
	const device = getDeviceIdentity();
	const pageSession = getPageSessionId();
	while (
		length &&
		batch.length < 50 &&
		(batch.length === 0 || performance.now() - started < 4)
	) {
		const entry = ring[head]!;
		ring[head] = undefined;
		head = (head + 1) % CAPACITY;
		length--;
		try {
			const clock = clockProperties(entry.clock, entry.wall, entry.mono);
			batch.push(
				prepareEvent({
					event: entry.name,
					distinct_id: device.id,
					uuid: crypto.randomUUID(),
					// Uncalibrated events use PostHog receipt-time indexing only.
					timestamp:
						clock.t_server === null
							? undefined
							: new Date(clock.t_server).toISOString(),
					properties: {
						input_id: entry.input,
						...entry.context,
						...entry.props,
						...clock,
						device_id: device.id,
						device_label: device.label,
						page_session_id: pageSession,
						seq: entry.seq,
						t_mono: entry.mono,
						t_wall: entry.wall,
						environment: config.environment,
						commit: __BUILD_INFO__.commitHash,
						$process_person_profile: false,
						$geoip_disable: true,
					},
				}),
			);
		} catch {
			invalid++;
		}
	}
	for (const sink of sinks) {
		try {
			if (batch.length) sink.write(batch);
			sink.flush();
		} catch {
			invalid++;
		}
	}
	lastDrainMs = performance.now() - started;
	maxDrainMs = Math.max(maxDrainMs, lastDrainMs);
	if (Date.now() - healthAt >= 30000) {
		healthAt = Date.now();
		let sinkDropped = 0;
		let failures = 0;
		for (const sink of sinks) {
			try {
				const stats = sink.stats();
				sinkDropped += stats.dropped;
				failures += stats.failures;
			} catch {
				invalid++;
			}
		}
		track("mm.telemetry.health", {
			...telemetryStats(),
			sink_dropped: sinkDropped,
			sink_failures: failures,
		});
		maxDrainMs = 0;
	}
	arm(length ? 0 : 2000);
}
const onPageHide = () => flushNow();
const onVisibility = () => {
	track("mm.app.visibility", { state: document.visibilityState });
	if (document.visibilityState === "hidden") flushNow();
};
export function startTelemetry(
	runtime: RuntimeConfig,
	selected?: TelemetrySink[],
): () => void {
	if (config) return stopTelemetry;
	config = runtime;
	sinks = selected ?? selectSinks(runtime);
	healthAt = Date.now();
	const device = getDeviceIdentity();
	track("mm.session.start", {
		...collectDeviceTraits(),
		persisted: device.persisted,
		is_new_device: device.isNew,
		autocapture_enabled:
			runtime.environment !== "emulator" && runtime.telemetry === "on",
	});
	window.addEventListener("pagehide", onPageHide);
	document.addEventListener("visibilitychange", onVisibility);
	arm(2000);
	return stopTelemetry;
}
export function stopTelemetry() {
	clearTimeout(timer);
	timer = undefined;
	window.removeEventListener("pagehide", onPageHide);
	document.removeEventListener("visibilitychange", onVisibility);
	for (const sink of sinks) {
		try {
			sink.stop();
		} catch {
			/* silent */
		}
	}
	sinks = [];
	config = undefined;
}
export function __resetForTests() {
	stopTelemetry();
	ring.fill(undefined);
	head = 0;
	length = 0;
	seq = 0;
	dropped = 0;
	invalid = 0;
	input = null;
	inputSeq = 0;
	context = emptyContext;
	healthAt = 0;
	lastDrainMs = 0;
	maxDrainMs = 0;
	for (const key of Object.keys(counters) as (keyof typeof counters)[])
		counters[key] = 0;
}
