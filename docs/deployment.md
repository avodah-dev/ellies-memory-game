# Fly.io deployment

Matchimus runs on Bun and Fastify in a Docker container. Firebase remains the backend for anonymous authentication, game state, presence and cursors. The Fly organization is `avodah`.

The GitHub repository is [avodah-dev/ellies-memory-game](https://github.com/avodah-dev/ellies-memory-game). Its `main` branch requires a pull request and an up-to-date passing `verify` check, including for administrators. Fly deployment credentials live in this repository's GitHub environments.

| Branch | GitHub environment | Fly app | Runtime environment |
| --- | --- | --- | --- |
| `staging` | `preview` | `matchimus-preview` | `preview` |
| `main` | `production` | `matchimus` | `production` |

`fly.toml` and `fly.preview.toml` bind the server to registered port 5457, force HTTPS and check `/healthz`. Production keeps one machine warm; preview may stop when idle. Both use shared CPU/256 MB in `ord`. Application data lives in Firebase, so no Fly volume is needed.

## Configuration

`FIREBASE_CONFIG_JSON` is a Fly runtime secret containing the existing Firebase **web** configuration. `APP_ENV` explicitly selects `preview`, `production` or `emulator`. The server refuses missing/invalid hosted configuration and exposes only whitelisted public fields through uncached `/app-config.json`. Admin keys and unrelated environment variables are never included. Analytics is enabled only for the production environment.

The image contains no Firebase environment credentials. The same image is tested against local emulators and then published to Fly. `APP_COMMIT` identifies the build in `/healthz` and the browser build-info dialog. `.env*`, `.git`, local dependencies and test output are excluded from the Docker context.

Both Fly apps are configured to use the existing `matchimus` Firebase project (`main-firestore` database). **Preview therefore shares live backend data**; it is not an isolated Firebase staging database. Local verification is fully isolated. Obtain the required explicit production-access authorization before live online smoke tests, Firebase rule changes or domain cutover. Use newly created test rooms for live checks.

The game document format changes to an immutable deck plus selected indexes and match ownership. Existing game documents are not migrated or accepted by the new client; players need fresh rooms after cutover. The new rules also reject the old Vercel client's writes. Inspect current deployed rules after authorization and coordinate the rules/client/DNS cutover; do not deploy the new rules while expecting the old client to keep supporting online games. Retain the previous rules alongside the previous image for a coordinated rollback.

The machine's Keychain registry holds `matchimus-firebase-web-config`, `matchimus-fly-deploy-token`, and `matchimus-preview-fly-deploy-token`. App-scoped Fly deploy tokens are installed as `FLY_API_TOKEN` in the matching GitHub environments and expire after 90 days. Renew them before expiry. Never put their values into files, command arguments or chat.

## Local release gate

Prerequisites: Bun 1.3.9, Node 24, Java 21+, Docker running, and installed Playwright Chromium/WebKit browsers.

```sh
bun install --frozen-lockfile
bun run verify:release
```

This runs `verify:local`'s checks plus a Linux/amd64 Docker build, actual container startup, HTTP checks and both browser suites against the running container. Browser clients connect only to local emulators. Missing assets return 404, direct application routes serve the SPA, and hashed assets have immutable caching. The script stops its container and emulator processes when complete.

`bun run test:container` can be used with an already-running emulator stack. Do not bind another server to port 5457 while it runs.

## Hosted release

1. Open a PR and require the `verify` check. It runs the full release gate on GitHub's runner.
2. After verification and the required live-backend authorization, push the reviewed commit to `staging`. The **Fly release** workflow runs through the actual push trigger, repeats the release gate, publishes the exact tested image, and deploys it to `matchimus-preview`.
3. Verify the preview and plan any Firebase rule changes before merging. Rules are a separate deployment and must target the explicit `matchimus` project and named database. They are not automatically changed by the Fly workflow.
4. Merge the reviewed PR to `main`. The same workflow tests and deploys `matchimus`, then checks that the live health endpoint reports the expected commit and production environment.
5. Verify the custom domain/certificate and gameplay after cutover.

A manual Actions run is also available for `main` or `staging`. Deployments are serialized per branch and have a 20-minute job limit. Verification has its own ten-minute limit. Failures appear in GitHub Actions, independently of the Fly app, and upload available reports. A failed health check or deployment fails the job; it does not count as a successful release.

The workflow depends on GitHub/Fly availability, valid deploy tokens, Docker and downloadable build/browser/emulator dependencies on the runner. Local operation additionally requires Docker running and the registered ports free. Failed prerequisites stop the pipeline before deployment.

`vercel.json` disables automatic Git deployments during migration. It does not delete the old deployment or move DNS. A Vercel-owned `*.vercel.app` hostname cannot move to Fly; a user-owned custom domain needs a Fly certificate and DNS cutover.

The existing public hostname is `play.matchimus.app`. Nathan will make the DNS changes himself after the Fly deployment and certificate requirements are verified. Do not change DNS or access the registrar as part of the deployment workflow. Keep the current Vercel destination available until the cutover is confirmed working.

## Rollback

Record the previous image reference before release. After authorization, redeploy that known-good image with the appropriate Fly config. A frontend rollback does not roll back Firebase rules: assess them separately, and do not reinstate an older client against incompatible rules. Keep old deployment evidence until the new domain and online flow are verified.

## Installed apps and Reload App

A PWA installed from `play.matchimus.app` keeps the same origin when hosting moves between providers. A hosting move alone does not require reinstalling it. An installation from a different hostname must be replaced with one installed from the public hostname.

Reload App asks for confirmation, unregisters same-origin service workers, deletes same-origin Cache Storage, then replaces the current page with a unique home-page URL. Each cleanup phase has a three-second limit; unavailable or blocked browser APIs produce a warning and do not prevent navigation. Cookies, localStorage and IndexedDB are retained, preserving preferences and Firebase identity. The current game is not resumed.

The Fastify response to that explicit reload sends `Clear-Site-Data: "cache"` to request HTTP-cache removal in supporting browsers. App HTML is always `Cache-Control: no-store`; fingerprinted assets remain immutable. The one-time reload query is removed before application startup. This is the strongest supported in-app cleanup, not a guarantee that every browser cache is flushed: JavaScript cannot flush OS/DNS caches, update another device, or replace code in an old installation that has not yet downloaded this reload implementation. Other open tabs can still run their existing code. Close and reopen affected tabs if needed, and use a fresh room after an incompatible protocol release.

Local browser tests install a real controlling legacy service worker that returns stale app HTML, then exercise the actual Reload App button and check that navigation reaches the network and saved storage survives. The worker fixture is copied into the local preview build or mounted read-only into the test container; it is not included in the released image.

## Diagnostics server foundation (PR 1)

Hosted servers require `APP_TELEMETRY=on` or `APP_TELEMETRY=off`; missing or invalid values prevent startup. Both Fly configurations explicitly select `on`. The validated setting is exposed as `telemetry` in the uncached `/app-config.json`. Emulator configuration explicitly selects local diagnostics (`telemetry: "on"`), but never enables PostHog or registers ingestion proxy routes, including when running the production container against emulators.

`off` omits `/ingest/*` and prevents the existing production browser PostHog client from initializing on its next startup/reload. This is a startup configuration switch: changing it requires a server restart/deploy and does not remotely stop a client already running. PR 1 leaves the existing production `api_host` and autocapture configuration unchanged; preview client analytics, the batch sink, and the `/ingest` client transport change belong to PR 2. Local diagnostic storage will be introduced in PR 2.

`GET /diag/ping` is always available, returns `{ "now": <server epoch milliseconds> }`, and sends `Cache-Control: no-store`. It does not access Firebase or PostHog. Preview may cold-start, so connection tests must distinguish the first request from warm requests.

When hosted telemetry is on, `GET` and `POST /ingest/*` relay to fixed US PostHog hosts: `/static/*` and `/array/*` use `us-assets.i.posthog.com`; other paths use `us.i.posthog.com`. The proxy preserves request bytes and query strings, forwards only content type, accept, user agent, and a valid Fly client IP, and never forwards cookies or authorization. Redirects are rejected. It removes upstream cookies, compression/length headers for the decoded response, and hop-by-hop headers. Network failures, redirects, or a ten-second upstream timeout return an empty 502 with a sanitized warning; HTTP errors such as 429 and their retry headers are preserved.

The request-body limit is **1 MiB**, intentionally sized for diagnostic batches of at most 48 KiB. Decoded upstream responses are bounded to **8 MiB**, independent of their declared/compressed length; exceeding that limit cancels the stream and returns an empty 502. This is not a general session-recording proxy: larger existing PostHog recording payloads would be rejected. Evaluate these limits before the PR 2 client transport change; PR 1 does not redirect existing analytics through it.

`bun run test:ingest-runtime` exercises the real Bun fetch transport against a loopback-only upstream on the registered server port. It verifies compressed request/response handling, header stripping, and redirect blocking. Both `verify:local` and `verify:release` run it alongside Node server tests; production-container checks also confirm `/diag/ping`, runtime configuration, and absent emulator ingestion routes. No verification traffic is sent to PostHog.

Opening diagnostics PRs and running PR CI do not deploy. Updating `staging` deploys `matchimus-preview`, which shares the live Firebase backend; merging to `main` deploys production. Both require Nathan's explicit current approval. Before merging the future batch sink, a separately authorized single manual `/batch/` probe must verify the payload and ingestion; record the exact non-sensitive payload and result. Firebase rules remain unchanged throughout PRs 1–4.
