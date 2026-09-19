# Architecture and testing boundaries

## Application ownership

`App.tsx` owns one `useAppModel` lifecycle and renders `AppShell`. TanStack routes render the home, setup, lobby, gameplay and results screens through `Outlet`. The shell owns shared overlays. The typed Zustand `appModelStore` publishes the model to route screens without React Context. `useAppModel` still coordinates setup/navigation and is the next place to split by feature as behavior changes; moving JSX into routes is the first incremental boundary, not a full rewrite.

`useBoardLayout` owns measurement/resize listeners and `useFullscreen` owns fullscreen behavior. Persisted preferences live in `settingsStore`; transient UI and online membership/presence have separate stores. There is no second unused game-state store. Prefer specific Zustand selectors so cursor/presence changes do not wake unrelated consumers.

## Rules and lifecycle

`GameEngine` contains pure rules and derived scores/winners. It creates paired cards and uses an injectable Fisher–Yates shuffle. `useGameController` owns the current game, synchronous action state, match-resolution timers and effects. Local and online modes share it. Controller settings are a typed subset of the persisted settings contract.

Two rapid card activations cannot overwrite each other through stale React state. Timer cleanup handles reset, state replacement and unmount. The last match marks the game finished in the domain; flying-card animation never writes authoritative state. Routes can delay the results presentation independently.

## Online protocol

The named Firestore database `main-firestore` stores `rooms/{code}` and `games/{code}`. A game revision is `(gameRound, syncVersion)`, compared in that order. Runtime boundary parsing rejects malformed cards, ownership, membership and revision metadata.

`FirestoreSyncAdapter` accepts injected Firebase clients, enabling isolated anonymous users in integration tests. Joining reserves the second slot in a transaction. Guest departure deletes that map field. Starting/replaying updates the room and game atomically and increments the round. Moves require exactly the next revision, the same round, current-turn membership and a playing room; stale writers fail explicitly.

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

Firestore rules enforce membership, top-level shape, turn authority and revisions. They do not recompute every card transition on a trusted server; this is not a cheat-resistant competitive protocol. A server-authoritative command API would be a separate change if that becomes a requirement.

Room/game refresh currently returns users to the home flow; durable session restoration is not introduced. A local browser profile persists its anonymous identity and preferences, while emulators themselves are disposable. Physical iPad behavior, production configuration, deployments and hosted CI require their own verification. Asset/bundle optimization and further setup-controller decomposition can follow measured needs without replacing the current stack.
