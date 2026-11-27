# Backlog

Known issues and improvements that haven't been fixed yet. They come from the November 2026 code review and the browser testing done for PR #33. File and line references are from that review, so check them before starting work.

## Bugs

### Two modals at once while the opponent is away
When the host refreshes or leaves mid-game, the guest sees "Game paused / Connection interrupted / Reconnect" on top of the opponent-disconnected overlay. The guest's own connection is fine, so "Connection interrupted" and "Reconnect" are misleading. Show one overlay that explains the opponent is away.

### Connection badge says "Connected" while offline
The lobby's status badge stays green and reads "Connected" after the browser goes offline. It appears to track sign-in state, not network state.

### Flaky telemetry boot tests
Two tests in `src/main.test.tsx` ("boot honors telemetry production/on|off …") failed once under a loaded full run, then passed on every rerun. They look sensitive to timing.

## Security

### Room codes can be guessed
- **Codes:** 4 characters (about 330,000 possibilities), generated with `Math.random` (`src/services/game/GameEngine.ts`).
- **Reads:** any signed-in anonymous user can read any room and its presence data, including player names (`firestore.rules`, `database.rules.json`).
- **Cleanup:** rooms, games and presence records are never deleted, so used codes pile up.

Fix: longer codes from `crypto.getRandomValues`, a TTL or cleanup job, and tighter RTDB validation (rules allow 100-character names; the UI caps them at 20).

### Card data from the host isn't checked; no production CSP
`validGame` in `firestore.rules` doesn't validate card shape. `card.gradient` goes into a `className` and `card.imageUrl` into an `<img src>` (`src/components/Card.tsx`). A malicious host could make the guest's browser load any URL. It isn't XSS. A CSP is only sent in emulator mode (`server/app.ts`).

Fix: have clients check `imageUrl` and `gradient` against the local deck by `imageId`, and add a production CSP.

## Code quality

### Fallbacks
- `|| CARD_DECKS[0]` for an unknown pack: `OnlineLobby.tsx`, `useAppModel.ts`.
- Pair-count fallback chains: `useAppModel.ts` (`options.pairCount || 20`, among others), `OnlineLobby.tsx`.
- Hardcoded default room config in `WaitingRoom.tsx`.
- `lastSeen` falls back to `Date.now()` in `onlineStore.ts`.
- `room.config?.` branches are dead: `parseRoom` already requires a config.
- `Room.createdAt` and `lastActivity` are typed `number` but are Firestore Timestamps (`src/types.ts`).

### Dead code
- `triggerGameFinish` is never called (`src/hooks/useGameController.ts`).
- Sync branches after an early `isOnlineMode` return can't be reached (`useGameController.ts`).
- Unused: `CursorService.subscribeToRoomCursors`, `cleanupRoomCursors`, `PresenceService.subscribeToPlayerPresence`.
- Router devtools are gated on `MODE === "development"`, but dev runs `--mode emulator`, so they never appear (`src/routes/__root.tsx`).
- `.env` and `.env.example` list `VITE_FIREBASE_*` variables the code no longer reads.

### Maintainability
- **Large hook:** `useAppModel.ts` is about 1,700 lines and returns about 115 fields. `App.tsx` republishes it into a Zustand store on every change, and screens select the whole model.
- **Duplicate start logic:** game start lives in both `OnlineLobby.tsx` and `useAppModel.ts`, with different pair-count handling.
- **Hand-maintained routes:** the SPA route list in `server/app.ts` has no test against the route tree, so a new route will 404 on a deep-link reload.
- **Listener cleanup:** `CursorService` unsubscribes with `off(ref)`, which removes every listener on that ref. RTDB `onValue` calls have no error callback (`PresenceService.ts`, `CursorService.ts`).
- **Untested path:** room-listener failures have unit tests only. A terminal Firestore listener error couldn't be produced in a real browser.

## Stack conventions
- **Lint and format:** ESLint and Prettier, to be replaced with Biome. Seven stale `biome-ignore` comments remain.
- **Tailwind 3, not 4.** The README says staying on 3 was deliberate, so confirm before migrating.
- **No shadcn:** modals and inputs are hand-rolled.
- **Spelling:** "cancelled" appears in identifiers and UI copy (`src/utils/cardInput.ts`, `src/services/diagnostics/touchProbe.ts`, `src/components/ConnectionTestModal.tsx`). Change to "canceled".

## Design
- **Waiting room colors:** the design hook flagged purple/violet gradients in `src/components/online/WaitingRoom.tsx` (Quick Setup card, card-back swatch) as a generic AI palette.
