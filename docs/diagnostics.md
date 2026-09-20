# Multiplayer diagnostics

## Clock contract

Use **RTDB time only** for merged room timelines. `t_server` is `t_wall + offset_rtdb_ms` when `clock_reference = 'rtdb'`; otherwise it is null and the reference is `uncalibrated`. Never coalesce HTTP, RTDB and raw device time into one timeline. Older builds without `clock_reference` do not satisfy this contract; capture a new baseline after both devices reload the instrumentation build.

Every event carries both `offset_http_ms` and `offset_rtdb_ms`, the HTTP sample RTT (`clock_rtt_ms`), calibration ages (`clock_http_age_ms`, `clock_rtdb_age_ms`), and the selected reference. An unavailable offset/age is null, not zero. A genuine numeric zero offset is valid. The queue captures an immutable calibration reference alongside the event; a sample received before drain cannot retroactively calibrate an earlier event.

The room connection hook observes `.info/serverTimeOffset` without changing gameplay readiness. A finite sample and the existing connected signal are both required. Disconnect, listener failure and room cleanup invalidate calibration; reconnect can calibrate again. Online rooms can still have uncalibrated events, especially during startup and outages. Local-only play without an RTDB connection remains uncalibrated. Keep these events in the per-device sequence audit; do not silently substitute another clock when merging them.

RTDB offset is an estimate, not a precision latency measurement. [Firebase documents that network latency affects its accuracy](https://firebase.google.com/docs/database/web/offline-capabilities#clock-skew), making it most useful for detecting discrepancies above one second. The HTTP ping RTT is **not** an uncertainty bound for RTDB calibration. Use `performance.now()` durations for same-device latency, and state clock uncertainty when reporting cross-device timings. Display sample ages and flag old samples; the current implementation does not silently expire or replace them while connected.

Both offsets are **server-minus-device corrections**: an offset of −14500 ms means the device clock is approximately 14.5 seconds fast relative to that reference. On 2026-09-20, Claude confirmed this Mac was 14.508 seconds fast using SNTP and independent HTTP references; the approximately −14.5-second offsets were device clock error, not Fly drift. Correcting the device clock during an open session can invalidate cached calibration; reload before recording the baseline.

HTTP offset remains useful for Connection Test's RTT/offset display. `fly_rtdb_skew_ms = offset_http_ms - offset_rtdb_ms` is an estimated Fly-minus-RTDB clock difference, emitted on every event including health when both samples exist. A negative value means the sampled Fly time was behind the sampled RTDB time. Measurements may have different ages and asymmetric network delays; this is a diagnostic signal, not proof of VM drift or a basis for correcting timestamps.

`fly.preview.toml` configures `auto_stop_machines = "stop"` and zero warm machines. Production keeps one machine warm. Stopping differs from suspending; these settings do not establish why a clock offset occurred. No Fly lifecycle setting is changed by diagnostics.

## Drain health

`mm.telemetry.health` is queued approximately every 30 seconds, then delivered on a subsequent bounded drain. Counters `dropped`, `invalid`, `sink_dropped` and `sink_failures` are cumulative; `queued` is the queue length at sampling.

- `ms_drain`: duration of the latest completed drain, including enrichment, serialization and synchronous sink dispatch/scheduling. An idle drain can report zero.
- `drain_ms_max`: maximum of those durations since the previous health event was queued (or telemetry startup for the first interval). It resets after that health event is queued, so an idle sample does not erase an earlier spike. This does not include asynchronous storage/network completion time, or browser time spent outside the drain.

`drain_ms_max` was absent in the PR 2 build `18d384f`; querying that name on those events returns null. It is a new interval maximum, not an alias for `ms_drain`. The four-millisecond enrichment budget cannot preempt an individual operation; the maximum can exceed it and must be measured rather than assumed.

## HogQL queries

Replace `ROOM` with the new room code. Every event-table scan has a seven-day timestamp bound; narrow it to the capture window and environment/build for a real investigation, especially if a room code has been reused. PostHog `timestamp` follows device wall time for these events: allow clock-error margin at the window edges. The bound limits scanned data; it does not calibrate event ordering. First check calibration coverage for **both** devices/page sessions; an empty or one-sided calibrated timeline is not a successful baseline. These query examples must be exercised against the released schema before baseline sign-off.

```sql
SELECT
    properties.device_id AS device,
    properties.page_session_id AS session,
    properties.clock_reference AS reference,
    count() AS event_count,
    min(toInt(properties.seq)) AS first_seq,
    max(toInt(properties.seq)) AS last_seq
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND event LIKE 'mm.%' AND properties.room_code = 'ROOM'
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
WHERE timestamp > now() - INTERVAL 7 DAY
  AND event LIKE 'mm.%'
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
WHERE timestamp > now() - INTERVAL 7 DAY
  AND event = 'mm.telemetry.health'
  AND properties.room_code = 'ROOM'
  AND properties.drain_ms_max IS NOT NULL
GROUP BY device, session, build
```

## Gameplay event dictionary (PR 3)

The TypeScript dictionary is `events.ts` plus `gameplayEvents.ts`. All events have device/page-session identity, sequence, captured clock reference, environment and build. Explicit event state overrides global context: an older snapshot or queued write retains its own round/revision. `input_id` identifies a click within its page session; `gesture_id` joins that click to its pointer down/up/cancel. `write_id`, `transaction_id`, `apply_id`, `listener_id` and `timer_id` are page-session-local counters, not globally unique IDs. Always join on device plus page session as well.

No names, colors, image URLs, full decks, cursor coordinates, exception messages or stacks are included by these diagnostic observations. The existing SDK analytics remain separately configured. Observer/proxy records contain operation names and scalar outcomes, never arbitrary method arguments or results.

| Events | Main fields / interpretation |
| --- | --- |
| `mm.conn.input` | `source`: browser/rtdb/opponent; `value`; round/revision. `observation='signal'` identifies raw callbacks; an absent/null `observation` identifies a full state snapshot. Layout effect runs and each new round/status record all three current inputs even if unchanged. Neither callback nor snapshot counts equal connection transitions. |
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

To investigate connection flaps, filter `mm.conn.input` to `observation='signal'`, order by `seq` within device/page session/source, and compare successive `value` observations. Repeated equal callbacks are not transitions; the first observation establishes initial state. Use the null-observation snapshots and `mm.conn.ready` for the complete readiness inputs at round start, not for counting flaps. The existing discriminator distinguishes callback from snapshot, not change from no change; no additional `kind` field is required.

The stale `triggerGameFinish` comment mentions a GameBoard callback, but current production completion uses `checkAndFinishGame` followed by the results effect. Tests and investigation should follow the active path. A cancelled results timer with no later schedule is different from a scheduled timer that fires late; timer IDs, elapsed times, frame/drift windows, final-write results, committed game status and route resolution distinguish these cases.

## Investigation queries

Use a fresh room with both devices on the same instrumentation build. Claude validated all twelve SQL blocks at documentation commit `bf495e8` against production room RAWR in project 261647 on 2026-09-20, including timestamp bounds, the unmatched-gesture CTE, dropped-work queries and the three-way delivery join. Three queries had output limits to cap returned rows. The unmatched-gesture and dropped-write queries returned no rows; all observed pointer input was mouse. Boolean filters were also confirmed on TUFL data. The later rejection-to-turn-acceptance query added in `475e31d` still awaits HogQL execution. This validates those queries on smoke-test data, not a complete real-device baseline. Use the clock-coverage query above first. Single-device durations are monotonic; cross-device differences remain estimates and may be negative because of calibration uncertainty.

Flip acceptance and rejection by device:

```sql
SELECT properties.device_label AS device, properties.game_round AS round,
       properties.result AS result, count() AS flips
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND event = 'mm.game.flip' AND properties.room_code = 'ROOM'
GROUP BY device, round, result
ORDER BY device, round, result
```

Out-of-turn rejections and the next accepted snapshot giving that same device its turn, within the same round/page session. This produces one row per rejection, including a null delay when no matching later acceptance was captured. The flip-count query above supplies total rejections; do not omit unmatched rows from the audit. Both timestamps are monotonic on the receiving device, so this delay does not depend on cross-device clock calibration.

```sql
WITH rejections AS (
    SELECT properties.device_id AS device,
           properties.page_session_id AS session,
           properties.game_round AS round,
           properties.local_slot AS slot,
           properties.input_id AS input_id,
           toInt(properties.seq) AS rejected_seq,
           toFloat(properties.t_mono) AS rejected_mono
    FROM events
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND properties.room_code = 'ROOM'
      AND event = 'mm.game.flip' AND properties.result = 'not-your-turn'
      AND properties.mode = 'online' AND properties.local_slot IS NOT NULL
), accepted AS (
    SELECT properties.device_id AS device,
           properties.page_session_id AS session,
           properties.game_round AS round,
           properties.current_player AS player,
           toInt(properties.seq) AS accepted_seq,
           toFloat(properties.t_mono) AS accepted_mono
    FROM events
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND properties.room_code = 'ROOM'
      AND event = 'mm.sync.snapshot.gate' AND properties.decision = 'accepted'
      AND properties.game_status = 'playing'
)
SELECT r.device, r.session, r.round, r.slot, r.input_id, r.rejected_seq,
       nullIf(minIf(a.accepted_mono, a.accepted_seq > r.rejected_seq), 0)
           - r.rejected_mono AS rejection_to_turn_accept_ms
FROM rejections AS r
LEFT JOIN accepted AS a ON r.device = a.device AND r.session = a.session
    AND r.round = a.round AND r.slot = a.player
GROUP BY r.device, r.session, r.round, r.slot, r.input_id,
         r.rejected_seq, r.rejected_mono
ORDER BY r.device, r.session, r.rejected_seq
```

A positive delay establishes that the click preceded a later accepted own-turn state; it does not establish what was visually displayed or why delivery took that long. Several rejected clicks can map to the same acceptance. A resynchronization may grant the turn outside the snapshot gate, leaving a null here; inspect `mm.sync.resync` and `mm.state.applied` before calling it missing delivery. Use a new instrumentation build: the stale revision metadata in preview build `548a89b` was corrected before production build `657931f`.

Pointer/click counts and readiness changes:

```sql
SELECT properties.device_label AS device, event, properties.phase AS phase,
       properties.pointer_type AS pointer_type, count() AS count
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND properties.room_code = 'ROOM'
  AND event IN ('mm.input.pointer', 'mm.input.click')
GROUP BY device, event, phase, pointer_type
ORDER BY device, event, phase
```

Do not equate down-minus-click count with a defect: cancelled gestures, scrolling, matched/disabled cards, leaving the page and keyboard activation have different paths. Join each click's non-null gesture ID to its pointer records within the same device/page session and inspect card IDs and cancellations.

Pointer-down gestures with no associated click, grouped by device/session and pointer type. Use `gesture_id`, not `input_id`: input IDs are created at click time. The cancelled subset helps distinguish intentional gesture cancellation from other unmatched downs; neither count alone proves a dropped tap. Run after the capture finishes and batches drain, since an in-flight click or a window boundary can leave a down temporarily unmatched.

```sql
WITH gestures AS (
    SELECT properties.device_id AS device,
           properties.page_session_id AS session,
           properties.gesture_id AS gesture,
           argMin(properties.pointer_type, toFloat(properties.t_mono)) AS pointer_type,
           countIf(event = 'mm.input.pointer' AND properties.phase = 'down') AS downs,
           countIf(event = 'mm.input.pointer' AND properties.phase = 'cancel') AS cancels,
           countIf(event = 'mm.input.click') AS clicks
    FROM events
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND properties.room_code = 'ROOM'
      AND event IN ('mm.input.pointer', 'mm.input.click')
      AND properties.gesture_id IS NOT NULL
    GROUP BY device, session, gesture
)
SELECT device, session, pointer_type,
       count() AS gestures_without_click,
       countIf(cancels > 0) AS cancelled_gestures
FROM gestures
WHERE downs > 0 AND clicks = 0
GROUP BY device, session, pointer_type
```

```sql
SELECT properties.device_label, properties.seq, properties.game_round,
       properties.source, properties.value, properties.observation,
       properties.ready, properties.browser_online,
       properties.rtdb_connected, properties.opponent_connected
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND properties.room_code = 'ROOM'
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
WHERE timestamp > now() - INTERVAL 7 DAY
  AND event = 'mm.sync.write.result' AND properties.room_code = 'ROOM'
  AND properties.ok = true AND properties.ms_input_to_commit IS NOT NULL
GROUP BY device
```

Join a write result to remote acceptance on room, game_round and sync_version, with **different device IDs**, and require `clock_reference='rtdb'` on both rows. Join remote acceptance to `mm.state.applied` and `mm.render.painted` on the receiving device/page session and revision, using the paint's apply ID to disambiguate reapplications. Use `ms_apply_to_paint` directly for that same-device duration. Exclude `phase='cancelled-before-task'` from latency aggregates but count those cancellations when investigating skipped states. Compare the complete tuple, not sync_version alone: replay resets revision numbers.

Dropped work and snapshot decisions, grouped separately by observation layer. Raw candidates are not accepted snapshots; do not add counts across layers as if they represented different delivered states.

```sql
SELECT properties.device_id AS device,
       properties.page_session_id AS session,
       event AS layer, properties.decision AS decision, count() AS observations
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND properties.room_code = 'ROOM'
  AND event IN ('mm.sync.snapshot.raw', 'mm.sync.snapshot.gate')
GROUP BY device, session, layer, decision
ORDER BY device, session, layer, decision
```

```sql
SELECT properties.device_id AS device,
       properties.page_session_id AS session,
       properties.reason AS reason, count() AS dropped_writes
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND properties.room_code = 'ROOM'
  AND event = 'mm.sync.write.dropped'
GROUP BY device, session, reason
ORDER BY device, session, reason
```

Host finish timeline:

```sql
SELECT properties.seq, event, properties.phase, properties.context,
       properties.timer_id, properties.game_status, properties.sync_version,
       properties.ok, properties.ms_elapsed, properties.error_code
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND properties.room_code = 'ROOM' AND properties.is_host = true
  AND event IN ('mm.game.match', 'mm.game.finish_check', 'mm.game.state',
                'mm.sync.write.enqueued', 'mm.sync.write.dropped',
                'mm.sync.write.result', 'mm.nav.results_timer', 'mm.nav.route',
                'mm.perf.longframe', 'mm.perf.timer')
ORDER BY properties.device_id, properties.page_session_id, toInt(properties.seq)
```

For render/cursor pressure, compare window deltas in `mm.perf.frames` against long frames and timer drift, with room/device/build fixed. Counts alone do not establish that a render caused a dropped tap. Existing autocapture predates the refactor and is unchanged here; compare PostHog SDK click timestamps with the independent input/game events without assuming it is a new regression.

Remote delivery and paint medians/p95, reported separately for each writer/receiver direction and receiving page session. Join keys include room via the identical room filter in every subquery, round and revision; writer and receiver must differ. To inspect individual revision samples, replace the final aggregate with `SELECT * FROM delivery ORDER BY writer, receiver, round, version`.

```sql
WITH delivery AS (
SELECT w.device AS writer, r.device AS receiver, r.session AS receiver_session, w.round, w.version,
       r.accepted_at - w.committed_at AS estimated_commit_to_accept_ms,
       p.painted_mono - r.accepted_mono AS accept_to_paint_ms,
       p.apply_to_paint_ms
FROM (
    SELECT properties.device_id AS device, properties.game_round AS round,
           properties.sync_version AS version,
           min(toFloat(properties.t_server)) AS committed_at
    FROM events
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND event = 'mm.sync.write.result' AND properties.room_code = 'ROOM'
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
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND event = 'mm.sync.snapshot.gate' AND properties.room_code = 'ROOM'
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
    WHERE timestamp > now() - INTERVAL 7 DAY
      AND event = 'mm.render.painted' AND properties.room_code = 'ROOM'
      AND properties.phase = 'after-frame-task'
      AND properties.ms_apply_to_paint IS NOT NULL
    GROUP BY device, session, round, version
) AS p ON r.device = p.device AND r.session = p.session
          AND r.round = p.round AND r.version = p.version
WHERE w.device != r.device AND p.painted_mono >= r.accepted_mono
)
SELECT writer, receiver, receiver_session,
       count() AS samples,
       quantile(0.5)(estimated_commit_to_accept_ms) AS median_commit_to_accept_ms,
       quantile(0.95)(estimated_commit_to_accept_ms) AS p95_commit_to_accept_ms,
       quantile(0.5)(accept_to_paint_ms) AS median_accept_to_paint_ms,
       quantile(0.95)(accept_to_paint_ms) AS p95_accept_to_paint_ms
FROM delivery
GROUP BY writer, receiver, receiver_session
```

This query uses the earliest accepted/painted occurrence of a revision per receiving page session. For repeated resynchronizations, use the detailed `apply_id` records instead. `committed_at` is the writer's transaction-promise completion observation; a peer may receive the commit before that promise resolves. Negative commit-to-accept estimates therefore need not be clock error. These samples do not measure Firestore server processing time, and sample absence can mean filtering or a cancelled paint rather than missing delivery. Use the raw snapshot and cancellation events to audit excluded revisions.

### Interpreting directional differences

Do not assume symmetric delivery merely because both browser sessions run on one Mac. They have separate Firebase connections, request histories, callbacks and accepted-revision samples. The measured cross-device difference combines peer snapshot arrival, writer transaction-promise acknowledgement timing, scheduling and calibration error. The writer observation is not the server's commit timestamp.

Averaging the two directional medians can cancel a constant relative clock bias. What remains is an average of the two underlying observation-delay medians, not an identified one-way network latency. Interpreting that midpoint as a common delivery delay, and the half-difference as clock error, additionally requires symmetric observation delays and comparable samples with stable calibration. These are not paired NTP exchanges. Report the **directional midpoint** alongside both directions and sample counts if useful; do not label it true delivery. The half-difference also includes genuine directional differences and sampling variation, so it is not an uncertainty bound or an identified per-device clock error.

For RAWR, the reported medians were −4 ms host→guest (15 samples) and +135 ms guest→host (3 samples). Their midpoint is 65.5 ms and half-difference 69.5 ms. Those arithmetic results alone establish neither “true delivery = 65.5 ms” nor “each device has ±69.5 ms offset error.” The reported Fly-minus-RTDB estimates differed by 62.2 ms (guest 81.9 ms, host 19.7 ms), consistent with differing calibration estimates; HTTP sample delay/asymmetry and sample ages also contribute, so this is not independent ground truth for RTDB error.

The current RTDB offset observer exposes a scalar offset without a paired RTT measurement. The Connection Test's acknowledged-write RTT is a different operation and cannot rank the accuracy of those offset observations. Adding `fly_rtdb_skew_ms` to RTDB-calibrated time would algebraically replace its correction with the HTTP correction (`t_wall + offset_http_ms`); it is not an independent improvement to the RTDB reference. Retain RTDB as the single merged reference for this instrumentation release, keep directional estimates labelled, and prioritize same-device monotonic durations. Any future calibration change needs its own measured validation.

### Verified RAWR smoke measurements

Claude queried production room RAWR on build `657931f`. Host 5D3C is device `f6cf3b3c…`; guest FA9A is `95d8e451…`.

| Metric | Host 5D3C | Guest FA9A |
| --- | --- | --- |
| Tap→transaction completion, median / p95 | 175 / 232 ms (10 samples) | 197 / 215 ms (2 samples) |
| Maximum transaction attempts | 1 | 1 |
| Accepted snapshot→paint opportunity, median / p95 | Not reported | 9.6 / 17.6 ms |
| Raw snapshot candidate / missing | 19 / 3 | 20 / 1 |
| Snapshot gate accepted / self-echo | 3 / 16 | 16 / 3 |
| Telemetry dropped / sink failures | 0 / 0 | 0 / 0 |
| Maximum drain duration | 1.7 ms | 2.1 ms |

The paint measure is an estimated paint opportunity, not physical display completion. The small, unequal sample counts and mouse-only input make this a smoke verification, not the MacBook/iPad baseline or proof of a performance regression. Empty dropped-write/long-frame results mean none were observed in this capture, not that those paths cannot occur.

Delayed writes, timers and paint tasks retain the room/role context captured when scheduled, so completing or cancelling after a room change cannot assign them to the new room.

Reconnect invalidates the previous RTDB candidate. Calibration remains absent until a new offset observation is available; repeated connection notifications retain the observation's original age. Diagnostic adapter callbacks are isolated: a failed trace start explicitly disables that trace, and other observer exceptions cannot abort a transaction, replace its error, prevent snapshot delivery or stop cleanup. Full-state replacement and reset generation bumps carry the same synchronization-session ID as queued writes.

The batch sink keeps its in-flight guard until the response body has been consumed, not merely until response headers arrive. This prevents adjacent diagnostic keepalive batches from overlapping that transport budget; the browser's keepalive quota is also shared with other traffic. Existing backoff and UUID retention are unchanged. Health counts failed attempts cumulatively even when a later send succeeds; audit successful batches/PostHog sequence IDs before concluding that an event was lost.

## Connection Test (PR 4)

Open **Settings → Advanced → Connection test**, then choose Start test. The eight steps run sequentially in the lobby or during a game. The game continues behind the modal. Close, Escape or Cancel test aborts the active scope and starts no later tests. Results appear as each step finishes; Copy results includes the complete report and device identity. A completed test is an observation, not a pass/fail verdict on playable latency. Tap tests are optional and require explicit Continue after each attempt, so the test does not disable the cards before a second click can arrive.

| Test | Measurement and limits |
| --- | --- |
| `http` | Ten same-origin no-store `/diag/ping` requests, three-second limit each and 35 seconds overall. `first_ping_ms` is separate from the nine warm samples (`min_ms`, `median_ms`, `p95_ms`). It is the first ping of this test, not a guarantee of a cold connection: boot calibration or prior traffic may have warmed it. `jitter_ms` is mean absolute difference between adjacent successful warm samples. Failures are counted, never substituted with zero latency. |
| `firestore` | Five sequential `getDocFromServer(rooms/0000)` reads; four seconds per read, 22 seconds overall including auth readiness. Missing document is the expected success. Reads stop after the first failure. The SDK cannot cancel an in-flight read; it may finish read-only in the background, but no later reads are issued. No Firestore writes. |
| `rtdb` | Temporary Firebase app with in-memory auth copied from the current anonymous user and its own RTDB connection. Registers `onDisconnect().remove()` on `cursors/0000/<uid>` before writing. Five sequential `set()` acknowledgements, three seconds each; optimistic local callbacks do not stop the RTT timer. Removes the scratch value, disconnects only the probe client and deletes that temporary app instance. Abort/timeout disconnects the probe, leaving the acknowledged server disconnect hook to clean up. The shared gameplay connection and auth are untouched. Overall deadline 26 seconds includes setup and cleanup. |
| `transport` | Completed resource-timing entries for `/Listen/channel`, counting `CI=1` as a polling hint. One-second deadline. Historical entries and missing in-flight entries cannot establish the currently active transport; `not-observed` is explicit. |
| `network` | Optional `navigator.connection` values: supported, effective_type, downlink_mbps, estimated_rtt_ms and save_data. Unsupported is expected on Safari. Browser estimates are not new measurements. One-second deadline. |
| `frames` | Two seconds of rAF intervals, p95/max and histogram bins; four-second deadline. Hidden pages stop with page-hidden. This measures frame scheduling under the current workload, not display completion. |
| `touch_a` | Ask for five taps on one card-styled button, then Continue. Record actual downs/ups/cancels/clicks, pointer types and matched down→up, down→click, up→click timings. Do not infer a click from a down. Sixty-second deadline; skip is explicit. |
| `touch_b` | Three explicit left-then-right attempts, 30 seconds per pair and 90 seconds overall. Record each pair's counters/timings as `pair_1_*` through `pair_3_*`, plus completed_pairs and both_clicked_pairs. The last click gap describes the recorded input; the test does not assume the user actually tapped rapidly or in the instructed order. No preventDefault, pointer capture or touch-action override. |

The reserved room code `0000` cannot be allocated by the letter-only room generator. Only the current user's scratch cursor is written. The RTDB cancellation design uses [Firebase's documented server acknowledgement and disconnect behavior](https://firebase.google.com/docs/reference/js/database); [updateCurrentUser](https://firebase.google.com/docs/reference/js/auth#updatecurrentuser) copies the current user into the isolated in-memory Auth instance. No Firebase/RTDB rules change is required or included. Parallel tests in separate tabs sharing a UID share the scratch path, so run one Connection Test per device at a time; the probe measures acknowledgement, not an echo of scratch contents.

Connection Test reports `measured_http_offset_ms` and `measured_rtdb_offset_ms` separately from the event envelope's existing clock calibration. Both are server-minus-device corrections. The test never overwrites gameplay calibration or uses HTTP time to merge room timelines. Per-probe measurements may be newer than the envelope's offsets; after a device-clock adjustment reload before a baseline.

Events use the existing bounded telemetry sinks: emulator stays local, hosted environments send diagnostic batches when telemetry is on. They retain room/role/round context from the start of the test even if the player navigates while it runs. No probe credentials, network URLs or arbitrary error messages are recorded.

| Event | Fields |
| --- | --- |
| `mm.conntest.start` | Unique `test_id` and captured room context. |
| `mm.conntest.result` | `test_id`, `test`, `status` (`ok`, `error`, `timeout`, `cancelled`, `skipped`) plus scalar metrics above. Status ok means the probe returned, not that the connection is fast or that every instructed tap occurred. |
| `mm.conntest.done` | `test_id`, `cancelled`, result count and monotonic `ms_elapsed`. A cancelled run can have fewer than eight results. |

```sql
SELECT properties.device_label AS device, properties.test_id AS test_id,
       event, properties.test, properties.status, properties.cancelled,
       properties.samples, properties.failures, properties.median_ms,
       properties.p95_ms, properties.measured_http_offset_ms,
       properties.measured_rtdb_offset_ms, properties.both_clicked_pairs,
       properties.ms_elapsed
FROM events
WHERE timestamp > now() - INTERVAL 7 DAY
  AND event IN ('mm.conntest.start', 'mm.conntest.result', 'mm.conntest.done')
  AND properties.room_code = 'ROOM'
ORDER BY properties.device_id, properties.page_session_id, toInt(properties.seq)
```

Run lobby and mid-game tests on both real devices for the baseline. Synthetic browser taps verify delivery and isolation, not iPad hardware timing. Local Vite dev/preview servers expose the same JSON ping contract; the container suite exercises Fastify's actual endpoint. Unit checks cover timeout/cancellation and server-ack sequencing; the two-browser flow verifies successful lobby probes, touch recording, mid-game snapshot delivery and cancellation while zero non-loopback requests and console-error gates remain active.
