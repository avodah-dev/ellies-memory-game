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
