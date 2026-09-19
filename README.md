# Matchimus

A two-player memory game for same-device and online play. React 19, TypeScript, TanStack Router, Zustand, Vite, Tailwind 3 and Firebase remain the application stack.

## Develop locally first

Prerequisites: Bun **1.3.9**, Node **24** (`.node-version`), Java **21 or newer** for Firebase emulators. The first emulator/browser installation requires internet access to download tooling. No Firebase login or production credentials are needed.

```sh
bun install --frozen-lockfile
bunx playwright install chromium webkit
bun run dev:local
```

Open **http://127.0.0.1:3472**. Use two separate browser profiles or an incognito window for online play: each player needs a different anonymous identity.

`dev:local` owns the Vite and Firebase emulator processes and stops them on Ctrl-C. It checks for occupied ports and refuses to reuse another stack. Emulator data is disposable. Close local sessions when restarting the emulators.

The local Firebase project is `demo-matchimus`, with Firestore database `main-firestore` and RTDB namespace `demo-matchimus-default-rtdb`. Auth, Firestore and RTDB all run on loopback. Local builds disable analytics and enforce a browser policy restricting connections/assets to local resources. If emulators are unavailable, the page displays a startup error.

Ports are reserved in the machine port registry and checked into `local-ports.json`: Vite 3472, preview 3473, Auth 5450, Firestore 5451, RTDB 5452, hub 5453, logging 5454, emulator UI 5455, Firestore WebSocket 5456, container/Fastify 5457. Update the registry before changing ports; `firebase.json` must match, and the runner checks this.

## Verify a change

Stop `dev:local`, then run the same entry point used by CI:

```sh
bun run verify:local
```

This runs zero-warning lint, application **and test** type checking, unit/component tests, real Firebase SDK/rules integration tests, critical-code coverage, an emulator build, and Playwright browser tests. It starts a fresh emulator stack, fails on occupied ports, applies a ten-minute limit, and cleans up its processes on success or failure.

| Command | Purpose |
| --- | --- |
| `bun run check` | Fast local lint, types and unit/component checks; no emulators required |
| `bun run test` | Watch unit/component tests while editing |
| `bun run test:coverage` | Coverage report; at least 90% branches **per file** for engine, state protocol and synchronization hook |
| `bun run test:integration` | Real Auth/Firestore/RTDB clients and checked-in rules; requires running emulators |
| `bun run build` | Build for emulator-backed browser verification |
| `bun run test:e2e` | Chromium desktop and WebKit iPad flows against the built app; requires emulators and a fresh build |

Playwright uses separate authenticated browser contexts for the two players, no retries, and real subscriptions. It exercises local play, keyboard activation, completion/replay, online room creation/join, synchronized flips, disconnect/pause/reconnect and online replay. HTTP requests outside loopback fail the test. The emulator tests also exercise RTDB's actual server-side `onDisconnect` trigger and observe the resulting presence change.

Reports: `coverage/index.html`, `playwright-report/index.html`; failed browser tests retain traces and screenshots in `test-results/`. Open a report with `bunx playwright show-report` or a trace with `bunx playwright show-trace <trace.zip>`.

For each bug: reproduce it locally, add a regression at the lowest layer that catches it, implement the fix, then run `verify:local`. Avoid assertion-only mocks of the behavior under test. Keep time and random inputs controlled in unit tests; use real services at integration boundaries. Browser device emulation does not replace occasional testing on physical iPads.

## CI and production

`.github/workflows/verify.yml` runs the same verification on pull requests or a manual Actions trigger, with report uploads even on failure. The workflow includes Docker/container verification. The hosted workflow must be exercised through GitHub Actions after publication; a local pass does not prove the hosted runner. Branch protection must be configured to require its `verify` job before merging.

Production runs on **Fly.io (Avodah)** using Bun/Fastify and the existing Firebase project. Build the image and verify its actual serving path locally before releasing:

```sh
bun run verify:release
```

This requires Docker and adds Linux/amd64 container verification to the local checks. The same tested image is released by GitHub Actions: `staging` deploys `matchimus-preview`, and `main` deploys `matchimus`. Firebase web configuration comes from the Fly runtime secret `FIREBASE_CONFIG_JSON`; the image itself is independent of that configuration. Preview currently shares the existing Firebase backend and therefore requires production-access authorization for live online testing.

`vercel.json` disables Git-triggered Vercel deployments during cutover. Firebase rules and custom-domain DNS changes are separate, explicitly authorized release steps. See the [deployment runbook](docs/deployment.md) for credentials, verification, triggers and rollback.

See [architecture](docs/architecture.md) and [Firebase setup](docs/firebase-setup.md). Enable verbose local gameplay logging only when needed with `VITE_GAME_DEBUG=true bun run dev:local`.
