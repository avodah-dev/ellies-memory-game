# Multiplayer diagnostics

## Clock contract

Use **RTDB time only** for merged room timelines. `t_server` is `t_wall + offset_rtdb_ms` when `clock_reference = 'rtdb'`; otherwise it is null and the reference is `uncalibrated`. Never coalesce HTTP, RTDB and raw device time into one timeline. Older builds without `clock_reference` do not satisfy this contract; capture a new baseline after both devices reload the instrumentation build.

Every event carries both `offset_http_ms` and `offset_rtdb_ms`, the HTTP sample RTT (`clock_rtt_ms`), calibration ages (`clock_http_age_ms`, `clock_rtdb_age_ms`), and the selected reference. An unavailable offset/age is null, not zero. A genuine numeric zero offset is valid. The queue captures an immutable calibration reference alongside the event; a sample received before drain cannot retroactively calibrate an earlier event.

The room connection hook observes `.info/serverTimeOffset` without changing gameplay readiness. A finite sample and the existing connected signal are both required. Disconnect, listener failure and room cleanup invalidate calibration; reconnect can calibrate again. Online rooms can still have uncalibrated events, especially during startup and outages. Local-only play without an RTDB connection remains uncalibrated. Keep these events in the per-device sequence audit; do not silently substitute another clock when merging them.

RTDB offset is an estimate, not a precision latency measurement. [Firebase documents that network latency affects its accuracy](https://firebase.google.com/docs/database/web/offline-capabilities#clock-skew), making it most useful for detecting discrepancies above one second. The HTTP ping RTT is **not** an uncertainty bound for RTDB calibration. Use `performance.now()` durations for same-device latency, and state clock uncertainty when reporting cross-device timings. Display sample ages and flag old samples; the current implementation does not silently expire or replace them while connected.

HTTP offset remains useful for Connection Test's RTT/offset display. `fly_rtdb_skew_ms = offset_http_ms - offset_rtdb_ms` is an estimated Fly-minus-RTDB clock difference, emitted on every event including health when both samples exist. A negative value means the sampled Fly time was behind the sampled RTDB time. Measurements may have different ages and asymmetric network delays; this is a diagnostic signal, not proof of VM drift or a basis for correcting timestamps.

`fly.preview.toml` configures `auto_stop_machines = "stop"` and zero warm machines. Production keeps one machine warm. Stopping differs from suspending; these settings do not establish why a clock offset occurred. No Fly lifecycle setting is changed by diagnostics.

## Drain health

`mm.telemetry.health` is queued approximately every 30 seconds, then delivered on a subsequent bounded drain. Counters `dropped`, `invalid`, `sink_dropped` and `sink_failures` are cumulative; `queued` is the queue length at sampling.

- `ms_drain`: duration of the latest completed drain, including enrichment, serialization and synchronous sink dispatch/scheduling. An idle drain can report zero.
- `drain_ms_max`: maximum of those durations since the previous health event was queued (or telemetry startup for the first interval). It resets after that health event is queued, so an idle sample does not erase an earlier spike. This does not include asynchronous storage/network completion time, or browser time spent outside the drain.

`drain_ms_max` was absent in the PR 2 build `18d384f`; querying that name on those events returns null. It is a new interval maximum, not an alias for `ms_drain`. The four-millisecond enrichment budget cannot preempt an individual operation; the maximum can exceed it and must be measured rather than assumed.

## HogQL queries

Replace `ROOM` with the new room code. First check calibration coverage for **both** devices/page sessions; an empty or one-sided calibrated timeline is not a successful baseline. These query examples must be exercised against the released schema before baseline sign-off.

```sql
SELECT
    properties.device_id AS device,
    properties.page_session_id AS session,
    properties.clock_reference AS reference,
    count() AS event_count,
    min(toInt(properties.seq)) AS first_seq,
    max(toInt(properties.seq)) AS last_seq
FROM events
WHERE event LIKE 'mm.%' AND properties.room_code = 'ROOM'
GROUP BY device, session, reference
ORDER BY device, session, reference
```

Merged timeline, using one reference only:

```sql
SELECT
    properties.t_server AS rtdb_time_ms,
    properties.device_id AS device,
    properties.page_session_id AS session,
    properties.seq AS seq,
    event,
    properties.offset_rtdb_ms AS rtdb_offset_ms,
    properties.clock_rtdb_age_ms AS calibration_age_ms,
    properties.fly_rtdb_skew_ms AS fly_rtdb_skew_ms
FROM events
WHERE event LIKE 'mm.%'
  AND properties.room_code = 'ROOM'
  AND properties.clock_reference = 'rtdb'
  AND properties.offset_rtdb_ms IS NOT NULL
  AND properties.t_server IS NOT NULL
ORDER BY toFloat(properties.t_server), device, session, toInt(properties.seq)
```

For the complete per-device sequence audit, select all `mm.*` events for the device and page session and order by `seq`, including rows without a room code or calibration. A room-only filter omits setup/teardown events and can create apparent gaps. Do not order uncalibrated events from different devices by PostHog `timestamp` and call that a calibrated timeline.

Drain maxima and clock difference:

```sql
SELECT
    properties.device_id AS device,
    properties.page_session_id AS session,
    properties.commit AS build,
    max(toFloat(properties.drain_ms_max)) AS max_drain_ms,
    max(toInt(properties.dropped)) AS dropped,
    max(toInt(properties.sink_failures)) AS sink_failures,
    max(abs(toFloat(properties.fly_rtdb_skew_ms))) AS max_clock_difference_ms
FROM events
WHERE event = 'mm.telemetry.health'
  AND properties.room_code = 'ROOM'
  AND properties.drain_ms_max IS NOT NULL
GROUP BY device, session, build
```

## Gameplay event dictionary (PR 3)

The TypeScript dictionary is `events.ts` plus `gameplayEvents.ts`. All events have device/page-session identity, sequence, captured clock reference, environment and build. Explicit event state overrides global context: an older snapshot or queued write retains its own round/revision. `input_id` identifies a click within its page session; `gesture_id` joins that click to its pointer down/up/cancel. `write_id`, `transaction_id`, `apply_id`, `listener_id` and `timer_id` are page-session-local counters, not globally unique IDs. Always join on device plus page session as well.

No names, colors, image URLs, full decks, cursor coordinates, exception messages or stacks are included by these diagnostic observations. The existing SDK analytics remain separately configured. Observer/proxy records contain operation names and scalar outcomes, never arbitrary method arguments or results.

| Events | Main fields / interpretation |
| --- | --- |
| `mm.conn.input` | `source`: browser/rtdb/opponent; `value`; round/revision. Raw callback observations have `observation='signal'`; layout observations record all three current inputs. Each new round/status gets a complete snapshot even if the inputs did not change. |
| `mm.conn.ready` | `ready`, `browser_online`, `rtdb_connected`, `opponent_connected`. Reports the committed composite; it does not participate in readiness. |
| `mm.input.pointer` | `card_id`, `phase`: down/up/cancel, `pointer_type`, `pointer_id`, `gesture_id`. Record-only React handlers; no preventDefault, capture, propagation or touch-action changes. |
| `mm.input.click` | `card_id`, `input_id`, `gesture_id`, `pointer_type`, `ms_down_to_click`. Keyboard/unmatched/cancelled gestures have null pointer latency. Older click events without pointer IDs are associated only when one gesture is unambiguous. |
| `mm.game.flip` | `result`: accepted/paused/not-ready/not-your-turn/checking-match/not-playing/two-selected/missing-card/already-flipped/already-matched. Also `paused`, `online_ready`, `checking_match`, `local_slot`, `mode`, and the state being evaluated. Gate precedence follows the existing application branches. |
| `mm.game.state` | `phase='committed'`, mode, local slot, online readiness and game status. Both local and online controllers exist; filter `mode='online'` for room diagnosis. |
| `mm.game.endturn` | accepted/paused/not-ready/not-your-turn. |
| `mm.game.match` | match/mismatch/lost-authority/missing-selected. |
| `mm.game.finish_check` | `matched_count`, `card_count`, `finished`, game status. Emitted immediately after the active `checkAndFinishGame(applyMatch(...))` path, before applying/synchronizing the final state. |
| `mm.game.match_timer` | `timer_id`, scheduled/fired/cancelled, `delay_ms`, `ms_elapsed`, cancellation reason. Covers effect cleanup and cancellation by synchronization, reset, initialization and end-turn. Cleanup after firing is not a cancellation. |
| `mm.nav.results_timer` | Same timer fields, plus navigation-resolved/navigation-rejected. Observes the existing 1200 ms effect, with unchanged dependencies. |
| `mm.nav.route` | Resolved pathname. Results timer fire is distinct from navigation completion and actual `/game-over` route resolution. |
| `mm.sync.write.skipped` | local/no-adapter/paused and caller `context`. |
| `mm.sync.write.enqueued`, `.dequeued`, `.dropped` | `write_id`, captured input ID, `context`, epoch and round/revision. `queue_depth` counts waiting writes (decremented at dequeue/drop); dequeued adds `ms_queue_wait`. Drops use reason epoch or pause, and retain both `paused` and `current_epoch` when both conditions are true. |
| `mm.sync.write.start`, `.result` | `transaction_id`, `write_id`, `ok`, `error_code`, `attempts`, `ms_get_game`, `ms_get_room`, `ms_commit`, `ms_tx_total`, `ms_input_to_commit`. Input latency is null for writes without a synchronous click origin. Read totals sum completed read phases across attempts; commit time is the final attempt's commit tail, and total includes retries/backoff. These are client-observed durations, not server processing times or a fixed RTT count. |
| `mm.sync.tx.phase` | attempt/get-game/get-room/commit with transaction ID, attempt number and elapsed phase time. No additional reads, parallelization or transaction retries are introduced. |
| `mm.sync.snapshot.raw` | Emitted before the adapter filter: exists, pending_writes, from_cache, round/revision, last_updated_by, decision missing/pending-write/cache/candidate. Candidate means eligible for parsing, not accepted by the hook. |
| `mm.sync.snapshot.gate` | stale-round/self-echo/not-newer/accepted, incoming round/revision, local_round/local_version. |
| `mm.sync.listener` | layer adapter/hook, listener ID, subscribe/unsubscribe/error, error code. Adapter cleanup on disconnect is included. |
| `mm.sync.pause`, `.resume`, `.epoch`, `.resync` | Pause/resume/epoch reasons, `ms_paused`, resync start/stale/resolved/rejected/listener-error/manual-reconnect. Inspect adjacent error and connection events to identify the pause trigger. |
| `mm.sync.call` | Promise-returning adapter method, call ID, start/resolved/rejected/threw, elapsed time and error code. Original promise identity and method receiver are preserved. |
| `mm.room.create/join/start/leave/reset` | Room-operation call timing; room code where available, no room payload. `start` includes startup transaction latency through the adapter call. Detailed transaction phases currently cover gameplay `setState` writes. |
| `mm.state.applied` | apply ID, source remote/controller and state revision. Controller assignment can follow remote acceptance; use the paint's apply ID for its measured start point. Optimistic local state can precede assignment of the queued revision. |
| `mm.render.painted` | after-frame-task/cancelled-before-task, apply ID, `ms_apply_to_paint`, `ms_layout_to_task`, render/publish totals and the rendered card array's revision. A layout effect → rAF → MessageChannel task estimates paint opportunity; browsers do not guarantee physical display completion. It excludes CSS-animation completion. |
| `mm.perf.frames` | Five-second visible-game windows: samples, ms_max, ms_window, interval buckets le_17/le_34/le_50/le_100/gt_100, and window deltas for card/board/app render attempts, model publications, cursor_rx callbacks and cursor_tx updatePosition calls. Cursor TX counts calls before the existing service throttle, not successful network writes. |
| `mm.perf.longframe` | rAF interval above 250 ms. |
| `mm.perf.timer` | Maximum drift of a 100 ms interval over 50 callbacks. |
| `mm.perf.longtask` | PerformanceObserver longtask/event entries where supported. Availability differs by browser; absence is not proof of no blocking. |

Frame/timer/performance observers run only on visible `/online/game` and `/local/game` routes and stop on results navigation or hidden visibility. For a controlled observer-cost comparison on preview, set sessionStorage `matchimus-frame-sampler` to `off` and reload, then remove that key and reload to enable. This turns off the performance samplers only, not input/sync/paint diagnostics or SDK analytics. Compare `drain_ms_max` as well. Never infer Safari performance from Chromium-only observer support.

The stale `triggerGameFinish` comment mentions a GameBoard callback, but current production completion uses `checkAndFinishGame` followed by the results effect. Tests and investigation should follow the active path. A cancelled results timer with no later schedule is different from a scheduled timer that fires late; timer IDs, elapsed times, frame/drift windows, final-write results, committed game status and route resolution distinguish these cases.

## Investigation queries

Use a fresh room with both devices on the same instrumentation build. The queries below are examples pending execution against the released PostHog schema. Use the clock-coverage query above first. Single-device durations are monotonic; cross-device differences remain estimates and may be negative because of calibration uncertainty.

Flip acceptance and rejection by device:

```sql
SELECT properties.device_label AS device, properties.game_round AS round,
       properties.result AS result, count() AS flips
FROM events
WHERE event = 'mm.game.flip' AND properties.room_code = 'ROOM'
GROUP BY device, round, result
ORDER BY device, round, result
```

Pointer/click counts and readiness changes:

```sql
SELECT properties.device_label AS device, event, properties.phase AS phase,
       properties.pointer_type AS pointer_type, count() AS count
FROM events
WHERE properties.room_code = 'ROOM'
  AND event IN ('mm.input.pointer', 'mm.input.click')
GROUP BY device, event, phase, pointer_type
ORDER BY device, event, phase
```

Do not equate down-minus-click count with a defect: cancelled gestures, scrolling, matched/disabled cards, leaving the page and keyboard activation have different paths. Join each click's non-null gesture ID to its pointer records within the same device/page session and inspect card IDs and cancellations.

```sql
SELECT properties.device_label, properties.seq, properties.game_round,
       properties.source, properties.value, properties.observation,
       properties.ready, properties.browser_online,
       properties.rtdb_connected, properties.opponent_connected
FROM events
WHERE properties.room_code = 'ROOM'
  AND event IN ('mm.conn.input', 'mm.conn.ready')
ORDER BY properties.device_id, properties.page_session_id, toInt(properties.seq)
```

Write latency and retries:

```sql
SELECT properties.device_label AS device,
       count() AS samples,
       quantile(0.5)(toFloat(properties.ms_input_to_commit)) AS median_input_to_commit_ms,
       quantile(0.95)(toFloat(properties.ms_input_to_commit)) AS p95_input_to_commit_ms,
       max(toInt(properties.attempts)) AS max_attempts
FROM events
WHERE event = 'mm.sync.write.result' AND properties.room_code = 'ROOM'
  AND properties.ok = true AND properties.ms_input_to_commit IS NOT NULL
GROUP BY device
```

Join a write result to remote acceptance on room, game_round and sync_version, with **different device IDs**, and require `clock_reference='rtdb'` on both rows. Join remote acceptance to `mm.state.applied` and `mm.render.painted` on the receiving device/page session and revision, using the paint's apply ID to disambiguate reapplications. Use `ms_apply_to_paint` directly for that same-device duration. Exclude `phase='cancelled-before-task'` from latency aggregates but count those cancellations when investigating skipped states. Compare the complete tuple, not sync_version alone: replay resets revision numbers.

Host finish timeline:

```sql
SELECT properties.seq, event, properties.phase, properties.context,
       properties.timer_id, properties.game_status, properties.sync_version,
       properties.ok, properties.ms_elapsed, properties.error_code
FROM events
WHERE properties.room_code = 'ROOM' AND properties.is_host = true
  AND event IN ('mm.game.match', 'mm.game.finish_check', 'mm.game.state',
                'mm.sync.write.enqueued', 'mm.sync.write.dropped',
                'mm.sync.write.result', 'mm.nav.results_timer', 'mm.nav.route',
                'mm.perf.longframe', 'mm.perf.timer')
ORDER BY properties.device_id, properties.page_session_id, toInt(properties.seq)
```

For render/cursor pressure, compare window deltas in `mm.perf.frames` against long frames and timer drift, with room/device/build fixed. Counts alone do not establish that a render caused a dropped tap. Existing autocapture predates the refactor and is unchanged here; compare PostHog SDK click timestamps with the independent input/game events without assuming it is a new regression.

Remote delivery and paint samples (one row per writer/receiver/round/revision):

```sql
SELECT w.device AS writer, r.device AS receiver, w.round, w.version,
       r.accepted_at - w.committed_at AS estimated_commit_to_accept_ms,
       p.painted_mono - r.accepted_mono AS accept_to_paint_ms,
       p.apply_to_paint_ms
FROM (
    SELECT properties.device_id AS device, properties.game_round AS round,
           properties.sync_version AS version,
           min(toFloat(properties.t_server)) AS committed_at
    FROM events
    WHERE event = 'mm.sync.write.result' AND properties.room_code = 'ROOM'
      AND properties.ok = true AND properties.clock_reference = 'rtdb'
      AND properties.t_server IS NOT NULL
    GROUP BY device, round, version
) AS w
JOIN (
    SELECT properties.device_id AS device, properties.page_session_id AS session,
           properties.game_round AS round, properties.sync_version AS version,
           min(toFloat(properties.t_server)) AS accepted_at,
           min(toFloat(properties.t_mono)) AS accepted_mono
    FROM events
    WHERE event = 'mm.sync.snapshot.gate' AND properties.room_code = 'ROOM'
      AND properties.decision = 'accepted' AND properties.clock_reference = 'rtdb'
      AND properties.t_server IS NOT NULL
    GROUP BY device, session, round, version
) AS r ON w.round = r.round AND w.version = r.version
JOIN (
    SELECT properties.device_id AS device, properties.page_session_id AS session,
           properties.game_round AS round, properties.sync_version AS version,
           min(toFloat(properties.t_mono)) AS painted_mono,
           argMin(toFloat(properties.ms_apply_to_paint), toFloat(properties.t_mono)) AS apply_to_paint_ms
    FROM events
    WHERE event = 'mm.render.painted' AND properties.room_code = 'ROOM'
      AND properties.phase = 'after-frame-task'
      AND properties.ms_apply_to_paint IS NOT NULL
    GROUP BY device, session, round, version
) AS p ON r.device = p.device AND r.session = p.session
          AND r.round = p.round AND r.version = p.version
WHERE w.device != r.device AND p.painted_mono >= r.accepted_mono
```

This query uses the earliest accepted/painted occurrence of a revision per receiving page session. For repeated resynchronizations, use the detailed `apply_id` records instead. `committed_at` is the writer's transaction-promise completion observation; a peer may receive the commit before that promise resolves. Negative commit-to-accept estimates therefore need not be clock error. These samples do not measure Firestore server processing time, and sample absence can mean filtering or a cancelled paint rather than missing delivery. Use the raw snapshot and cancellation events to audit excluded revisions.

Delayed writes, timers and paint tasks retain the room/role context captured when scheduled, so completing or cancelling after a room change cannot assign them to the new room.
