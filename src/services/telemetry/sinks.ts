import type { RuntimeConfig } from "../../../shared/runtimeConfig";
import { logDB, type LogEntry } from "../logging/LogDB";
import type { PreparedEvent, TelemetryEvent } from "./events";

// Public ingestion token already used by the browser SDK; not a personal API key.
export const POSTHOG_PROJECT_TOKEN =
	"phc_LMb2gHTzOA8grLHOZJFsGvfiX2Adcb41Nqbux1EW0yH";
export interface TelemetrySink {
	write(events: PreparedEvent[]): void;
	flush(): void;
	stop(): void;
	stats(): { dropped: number; failures: number };
}
export class MemorySink implements TelemetrySink {
	events: TelemetryEvent[] = [];
	write(events: PreparedEvent[]) {
		this.events.push(...events.map((record) => record.data));
	}
	flush() {}
	stop() {}
	stats() {
		return { dropped: 0, failures: 0 };
	}
}
export class IndexedDbSink implements TelemetrySink {
	private pending: PreparedEvent[] = [];
	private busy = false;
	private stopped = false;
	private dropped = 0;
	private failures = 0;
	constructor() {
		void logDB.trimToCount(20000).catch(() => {
			this.failures++;
		});
	}
	write(events: PreparedEvent[]) {
		if (this.stopped) return;
		this.pending.push(...events);
		if (this.pending.length > 2000)
			this.dropped += this.pending.splice(0, this.pending.length - 2000).length;
		this.flush();
	}
	flush() {
		if (this.busy || this.stopped || !this.pending.length) return;
		this.busy = true;
		const events = this.pending.splice(0, 50);
		const rows: Omit<LogEntry, "id">[] = [];
		for (const record of events) {
			try {
				const event = record.data;
				rows.push({
					timestamp: event.properties.t_wall,
					level: "debug",
					message: event.event,
					context: event.properties,
					roomCode:
						typeof event.properties.room_code === "string"
							? event.properties.room_code
							: undefined,
					playerSlot:
						event.properties.player_slot === 1 ||
						event.properties.player_slot === 2
							? event.properties.player_slot
							: undefined,
					sizeBytes: record.bytes,
				});
			} catch {
				this.dropped++;
			}
		}
		void logDB
			.addLogs(rows)
			.catch(() => {
				this.failures++;
				this.dropped += rows.length;
			})
			.finally(() => {
				this.busy = false;
				this.flush();
			});
	}
	stop() {
		this.stopped = true;
		this.pending = [];
	}
	stats() {
		return { dropped: this.dropped, failures: this.failures };
	}
}
export class PostHogBatchSink implements TelemetrySink {
	private pending: { json: string; bytes: number }[] = [];
	private busy = false;
	private stopped = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private backoff = 2000;
	private retryAt = 0;
	private dropped = 0;
	private failures = 0;
	private readonly onOnline = () => this.flush();
	private readonly fetchImpl: typeof fetch;
	constructor(fetchImpl: typeof fetch = fetch) {
		// Browser fetch requires a Window/Worker receiver; a class-method call
		// otherwise fails with Illegal invocation before any request is sent.
		this.fetchImpl = fetchImpl.bind(globalThis);
		window.addEventListener("online", this.onOnline);
	}
	write(events: PreparedEvent[]) {
		if (this.stopped) return;
		for (const record of events) {
			if (record.bytes > 47000) {
				this.dropped++;
				continue;
			}
			this.pending.push({ json: record.json, bytes: record.bytes });
		}
		if (this.pending.length > 2000)
			this.dropped += this.pending.splice(0, this.pending.length - 2000).length;
		this.flush();
	}
	flush() {
		if (this.busy || this.stopped || !this.pending.length || !navigator.onLine)
			return;
		if (Date.now() < this.retryAt) {
			this.schedule(this.retryAt - Date.now());
			return;
		}
		const prefix = `{"api_key":"${POSTHOG_PROJECT_TOKEN}","batch":[`;
		let bytes = prefix.length + 2;
		let count = 0;
		while (
			count < this.pending.length &&
			count < 50 &&
			bytes + this.pending[count].bytes + 1 <= 48 * 1024
		) {
			bytes += this.pending[count].bytes + 1;
			count++;
		}
		const batch = this.pending.splice(0, count);
		const body = prefix + batch.map((item) => item.json).join(",") + "]}";
		this.busy = true;
		void (async () => {
			try {
				const response = await this.fetchImpl("/ingest/batch/", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
					keepalive: true,
					credentials: "omit",
					redirect: "error",
					signal: AbortSignal.timeout(10000),
				});
				// Headers alone do not complete a keepalive request. Consume the
				// response before releasing busy so adjacent batches cannot overlap
				// the browser's shared 64 KiB in-flight keepalive budget.
				await response.arrayBuffer();
				if (!response.ok) throw new Error("Ingestion unavailable");
				this.backoff = 2000;
				this.retryAt = 0;
			} catch {
				this.failures++;
				if (!this.stopped) {
					this.pending.unshift(...batch);
					if (this.pending.length > 2000)
						this.dropped += this.pending.splice(
							0,
							this.pending.length - 2000,
						).length;
					this.retryAt = Date.now() + this.backoff;
					this.backoff = Math.min(30000, this.backoff * 2);
				}
			} finally {
				this.busy = false;
				if (this.pending.length)
					this.schedule(Math.max(0, this.retryAt - Date.now()));
			}
		})();
	}
	private schedule(ms: number) {
		if (this.stopped || this.timer !== undefined) return;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.flush();
		}, ms);
	}
	stop() {
		this.stopped = true;
		clearTimeout(this.timer);
		window.removeEventListener("online", this.onOnline);
		this.pending = [];
	}
	stats() {
		return { dropped: this.dropped, failures: this.failures };
	}
}
export function selectSinks(config: RuntimeConfig): TelemetrySink[] {
	switch (config.environment) {
		case "emulator":
			return [new IndexedDbSink()];
		case "preview":
		case "production":
			return config.telemetry === "on"
				? [new PostHogBatchSink(), new IndexedDbSink()]
				: [new IndexedDbSink()];
		default: {
			const impossible: never = config;
			throw new Error(`Unknown environment: ${impossible}`);
		}
	}
}
