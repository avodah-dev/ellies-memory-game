# Architecture and testing boundaries

## Application ownership

`App.tsx` owns one `useAppModel` lifecycle and renders `AppShell`. TanStack routes render the home, setup, lobby, gameplay and results screens through `Outlet`. The shell owns shared overlays. The typed Zustand `appModelStore` publishes the model to route screens without React Context. `useAppModel` still coordinates setup/navigation and is the next place to split by feature as behavior changes; moving JSX into routes is the first incremental boundary, not a full rewrite.

`useBoardLayout` owns measurement/resize listeners and `useFullscreen` owns fullscreen behavior. Persisted preferences live in `settingsStore`; transient UI and online membership/presence have separate stores. There is no second unused game-state store. Prefer specific Zustand selectors so presence changes do not wake unrelated consumers. Remote cursor positions are local state inside the `OpponentCursor` overlay: its RTDB subscription never publishes the app model or rerenders the board/cards. Only room/opponent identity and display metadata cross the model; the board keys the overlay by that identity. `useCursorBroadcast` sends local mouse movement without receive state. The existing service throttle and cursor visuals are unchanged.

## Rules and lifecycle

`GameEngine` contains pure rules and derived scores/winners. It creates paired cards and uses an injectable Fisher–Yates shuffle. `useGameController` owns the current game, synchronous action state, match-resolution timers and effects. Local and online modes share it. Controller settings are a typed subset of the persisted settings contract.

Two rapid card activations cannot overwrite each other through stale React state. Timer cleanup handles reset, state replacement and unmount. The last match marks the game finished in the domain; flying-card animation never writes authoritative state. Routes can delay the results presentation independently.

## Online protocol

The named Firestore database `main-firestore` stores `rooms/{code}` and `games/{code}`. A game revision is `(gameRound, syncVersion)`, compared in that order. Runtime boundary parsing rejects malformed cards, ownership, membership and revision metadata.

`FirestoreSyncAdapter` accepts injected Firebase clients, enabling isolated anonymous users in integration tests. Joining reserves the second slot in a transaction. Guest departure deletes that map field. Starting/replaying updates the room and game atomically and increments the round. Moves require exactly the next revision, the same round, current-turn membership and a playing room; stale writers fail explicitly.

Stored games separate the immutable card deck from `selectedIndexes` and a `matches` map (card index to player slot). The adapter reconstructs UI card flags from those fields. Firestore rules allow one new selection, a genuine selected pair awarded to the current player, or an end-turn transition. They preserve existing matches and only allow completion when all cards have owners. A new round starts with no selections or matches. Online New Game clears local state and changes routes only after the room reset succeeds.

`useGameSynchronization` serializes optimistic writes. It accepts only confirmed snapshots, ignores older rounds and self echoes, and invalidates queued work across rounds, room changes and subscription failures. A newer revision from another tab with the same identity is applied. It never overwrites a new session with a late resynchronization result.

Connection loss or a rejected write pauses actions and timers. Reconnection reads confirmed server state before resuming; explicit retry handles conflicts. If two unresolved cards belong to the reconnecting player, the controller restarts resolution. No player takes over a disconnected opponent's turn. Pending transactions already sent cannot be recalled, but transactions and revision checks prevent stale overwrites, and resynchronization uses the server result.

RTDB tracks presence and cursors. Presence registers its server-side disconnect hook before advertising online status and re-registers it after reconnect. Listener cleanup uses each subscription's own unsubscribe function.

## Test layers

- Pure rules/protocol: card pairing, immutability, scoring, turn/finish rules, revision ordering and malformed data. Critical files require 90% branch coverage each.
- Hook lifecycle: fake timers, rapid clicks, reset/unmount, failed writes, queue cancellation, room changes, stale snapshots/reads and reconnect.
- Components: actual cards, controller and Zustand preferences exercised with Testing Library/user-event. Older App tests still use broad mocks; browser tests cover their real composition.
- Firebase integration: anonymous authentication, concurrent joins, guest replacement, atomic start/replay, stale writes, unauthorized reads/writes, payload rules and actual RTDB disconnect/reconnect effects.
- Browser: built app and real emulators; Chromium desktop and WebKit iPad; keyboard/pointer, local and two-player online completion/replay, connection recovery, external-request isolation.

The local runner is also the CI entry point. `verify:release` adds a Linux/amd64 container build and repeats browser testing through the real Fastify serving path. Fly releases publish that exact tested image and inject Firebase configuration at runtime. Keep emulator rules and application code in the same change. Do not claim CI verified until the hosted workflow runs through its actual trigger.

## Remaining technical boundaries

Firestore rules enforce legal transitions, membership, turn authority and revisions. The host still chooses the initial deck and clients receive all card identities; preventing players from inspecting hidden cards would require a server that reveals them only when selected. This is not a fully cheat-resistant competitive protocol.

Room/game refresh currently returns users to the home flow; durable session restoration is not introduced. A local browser profile persists its anonymous identity and preferences, while emulators themselves are disposable. Physical iPad behavior, production configuration, deployments and hosted CI require their own verification. Asset/bundle optimization and further setup-controller decomposition can follow measured needs without replacing the current stack.

## Diagnostics (client foundation)

Telemetry uses `getRuntimeConfig().environment`. The emulator has only an IndexedDB sink; preview and production also have a direct PostHog batch sink when telemetry is on. Disabling hosted telemetry prevents both network analytics clients and removes the proxy, while retaining local diagnostic logs. Unit tests explicitly inject a MemorySink. Diagnostics never write to Firebase.

`track` records an immutable context reference, event props, sequence and monotonic/wall times in a 3000-entry drop-oldest ring. It does no serialization, IDB, UUID creation, scheduling or network work. Before startup it is inert except for this bounded buffer. A 2s timer drains at most 50 events per slice with a 4ms enrichment/serialization budget, yielding while work remains. Events are serialized once inside that budget and both sinks reuse the bytes. Batch dispatch/IDB scheduling also contributes to the reported `ms_drain`; `drain_ms_max` retains the peak since the preceding health report, including spikes before idle drains; JavaScript cannot preempt one expensive operation. Visibility-hidden/pagehide request a drain. Unsent events can be lost when a browser kills the page; this is not durable network delivery.

PostHog requests contain at most 50 events and48KiB of UTF-8 JSON, with one diagnostic request in flight. Retries retain event UUIDs, use 2–30s exponential backoff, stop offline, and cap pending events at 2000. The separate SDK may consume some of the browser's shared keepalive allowance. Failures and drops are counted, never console-logged by telemetry. IndexedDB uses bulk writes with a 2000-entry pending bound and trims old primary keys to 20000 entries once at startup. Local diagnostic rows appear in the existing Log Viewer. `mm.telemetry.health` reports queue, drop/failure and drain measurements every 30s.

A random UUID in `matchimus-device-id` survives settings changes and Reload App. Unavailable storage explicitly produces a session-only identity. A separate page-session UUID and sequence disambiguate tabs/reloads. Scalar store subscriptions carry room code, anonymous multiplayer ID, player slot and presence without copying names/colors or waking React. HTTP clock measurement selects the lowest RTT from 5 pings for diagnostics only. Merged room timestamps use RTDB exclusively: `t_server = t_wall + offset_rtdb_ms`, or null with `clock_reference: "uncalibrated"` when calibration is unavailable. Events retain the immutable clock snapshot captured at enqueue, both offsets, sample ages and an estimated Fly-minus-RTDB skew. A read-only offset observer follows the room’s existing connected signal without changing readiness. Monotonic time measures same-device durations; RTDB estimates remain latency-sensitive. See [diagnostics.md](diagnostics.md) for the clock contract, health fields and queries. Detailed gameplay/finish/navigation instrumentation belongs to diagnostics PR 3.

All `mm.*` events set `$geoip_disable: true` during drain, after caller properties, to suppress PostHog location enrichment. This does not strip the request IP. Existing SDK analytics and proxy IP forwarding remain unchanged; the privacy page discloses their IP-derived city, postal code and estimated coordinates.

Matched-card flights keep the existing board face and image node mounted inside its measured grid cell. A layout effect starts the decorative flight before paint; the placeholder stays beneath it and the face is removed only when the flight ends. Flight styling preserves the gameplay background and content size. No image reload/decode wait controls match resolution, turn state or input. Flying faces remain disabled and excluded from hit testing; matches/results previews have their own native buttons.
