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

1. Open a PR and require the existing `verify` check. Blacksmith runs the full release gate on the PR head revision; branch protection still requires it to be up to date. Successful same-repository runs export the **actual tested Linux/amd64 image**, its content ID, archive checksum, build commit, and full Git tree hash as a GitHub Actions artifact retained for 14 days. PR jobs have no Fly credentials.
2. After verification and live-backend authorization, promote the reviewed commit using the staging convention below. The **Fly release** workflow looks for a retained image from a completed successful verification/release run in this repository with the identical full Git tree. It checks the producing run/repository/event, GitHub's commit tree, manifest, archive checksum, loaded image ID/platform and baked-in build commit before publishing that image to Fly. No build or test suite is repeated on an image hit.
3. Missing/expired images trigger full verification and export on Blacksmith before release. An API failure, invalid manifest, checksum mismatch, or image mismatch fails the release; it does not quietly downgrade to a cache miss. Images uploaded by failed/canceled/in-progress runs or forks are ineligible. Workflow, test, lockfile, rules and Fly-config changes all change the tree key.
4. Verify preview before approving merge to `main`. Main uses the same promotion path. A merge/squash commit with an identical tree reuses the image. A changed tree requires full verification. Rules remain a separately approved deployment and are never changed by this workflow.
5. Post-deploy checks verify `/healthz` against the **image build commit**, runtime environment, uncached configuration/ping, SPA routes and bundled JavaScript. These HTTP checks do not execute the app or touch Firebase/PostHog. Fresh-room gameplay smoke tests remain a separate authorized live step.

The build-info UI and `/healthz.commit` truthfully retain the original tested image's commit. A tree-identical merge does not relabel or rebuild its contents. The deployment run summary records the branch's deployment commit, matching full tree, original image build commit, image ID, and source verification run; the Fly registry tag uses the deployment commit. Use that mapping when comparing GitHub's merge SHA with the app's Build Info.

### Staging branch convention

Keep `staging` as an append-only deployment history. Main accepts squash merges, so its commits differ from the original PR commits already rehearsed on staging. Before each rehearsal, merge current `origin/main` into staging locally, then merge the exact tested PR head. Push only the final result. Never force-push, reset the remote staging branch, merge staging into a feature branch, or open a staging-to-main PR. Production receives the reviewed feature PR through its normal squash merge.

Start from a clean working tree. Fetch, choose the full PR head SHA whose required verification passed, and confirm it includes current main:

```sh
git fetch origin
tested_commit='<full-verified-PR-head-SHA>'
git merge-base --is-ancestor origin/main "$tested_commit"
```

If the ancestry check fails, update the feature branch from main and verify its new head before continuing. Create a fresh local promotion branch from fetched staging; choose an unused branch name for each attempt:

```sh
git switch -c 'release/staging-rehearsal-<unique-name>' origin/staging
git merge --no-ff origin/main -m 'Reconcile main into staging'
git merge --no-ff "$tested_commit" -m 'Promote verified PR to staging'
```

Run each merge separately and stop on a conflict. Squash ancestry can produce conflicts even when the prior deployed trees were identical. Inspect the conflicting changes against main and the tested head; do not blindly select an entire side. Resolve and commit that merge before continuing, or abort it. An already-up-to-date merge is fine. Do not push the intermediate reconciliation commit: that would trigger an unnecessary deployment.

Require the final **full tree**, including workflows and docs, to equal the verified PR tree:

```sh
git diff --exit-code "$tested_commit" HEAD
test "$(git rev-parse HEAD^{tree})" = "$(git rev-parse "${tested_commit}^{tree}")"
```

Both checks must pass before the normal fast-forward push:

```sh
git push origin HEAD:staging
```

If the trees differ, stop: a previous unreleased rehearsal may have left changes on staging, or conflict resolution may have changed the candidate. Reconcile those changes explicitly; any intended application change belongs on the feature branch and needs verification there. Do not bypass the equality check because deployment could run another test suite. If the push is rejected because staging advanced, fetch and repeat from its new tip; never force it.

After the push, inspect the actual **Fly release** run and its source verification run, verify the deployed build through `/healthz`, and perform the authorized preview checks. A local merge or manual smoke command alone does not rehearse CI. If main advances before production merge, update and verify the PR and rehearse its new tree again. A failed rehearsal stays in staging history; a correction is another normal promotion. `workflow_dispatch` may rerun the existing main/staging deployment, but does not deploy arbitrary PR branches. This convention keeps the existing real staging-push trigger and image provenance checks.

### Verification and promotion prerequisites

PRs changing only `README.md`, `CHANGELOG.md`, or Markdown under `docs/` run lint/types/unit/server checks and skip browsers/containers. They produce **no deployable image**. Renames are classified as deletion plus addition so moving code into docs cannot skip tests. A subsequent deployment of a docs-only tree still needs a fully verified image and will run the full gate if none exists. The required `verify` job always runs, avoiding permanently pending path-filtered branch checks.

Both workflows use `blacksmith-4vcpu-ubuntu-2404` with SHA-pinned external actions. Full runs cache Bun downloads, exact Playwright browsers and Firebase emulator binaries keyed by lockfile/toolchain; browser OS libraries are always installed. The pinned Blacksmith Docker builder uses its persistent layer cache and explicitly refuses setup fallback. Container verification uses `docker buildx build --load`, testing the resulting image before export. Caches accelerate work; they never stand in for a passing test result. Suite parallelization is deferred: this change removes duplicate release runs without changing emulator/browser scheduling or test isolation.

A manual Actions run is available for `main` or `staging`. Deployments are serialized per branch with a 20-minute job timeout. Full verification retains its ten-minute limit. Failures and reports live in GitHub Actions, independently of Fly; configure GitHub Actions failure notifications for the responsible maintainers. A failed deploy or smoke fails the job and requires operator attention, rather than automatically rolling back or claiming success.

New prerequisites: the Blacksmith GitHub App must include this repository, its runner/builder service must be available, GitHub artifacts must be enabled, and the deployment token needs `actions: read` (declared in the workflow). Missing Blacksmith repository access leaves jobs queued until Nathan enables it. Expired/missing artifacts cost a full run. An unavailable GitHub API/artifact download stops promotion. Existing prerequisites remain valid Fly deploy tokens, Docker, downloadable dependencies, and GitHub/Fly availability. No additional stored credentials are introduced. Local verification needs Docker running and registered ports free.

Measured CI PR 10 results: staging 1m15s (previous10m45s), full Blacksmith gate 4m28s, complete PR run 6m20s. Original planning estimates: the prior staging release took about 11 minutes, including a second complete verification. Warm Blacksmith full runs are estimated at 5–8 minutes; retained-image promotions at 1–3 minutes. Cold caches, large image transfers and runner queues may take longer. Before calling this deploy path ready, exercise it through a **real authorized staging push**, verify that it selected a previously verified image and skipped the full gate, then inspect live health and HTTP smoke results. PR CI or a local replay alone does not prove the deploy trigger works.

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

Opening diagnostics PRs and running PR CI do not deploy. Updating `staging` deploys `matchimus-preview`, which shares the live Firebase backend; merging to `main` deploys production. Staging is covered by Nathan’s standing project permission; production needs approval for the current session or action. Before merging the future batch sink, a separately authorized single manual `/batch/` probe must verify the payload and ingestion; record the exact non-sensitive payload and result. Firebase rules remain unchanged throughout PRs 1–4.

## Diagnostics client foundation (PR 2)

Preview and production initialize existing PostHog autocapture/exceptions with `api_host: "/ingest"` and `ui_host: "https://us.posthog.com"` when telemetry is on. Common device/session/environment/build properties join SDK events with diagnostics. Dedicated diagnostic batches bypass `posthog.capture`; their independent bounded sink posts `{api_key,batch:[{event,distinct_id,uuid,timestamp,properties}]}` to `/ingest/batch/`, with `$process_person_profile:false` in properties. A manual preview probe on 2026-09-20 returned 200 `{"status":"Ok"}` (probe ID `2bb84b96-b81f-41bf-881d-8e46fbf8993d`); query confirmation is recorded with release evidence.

The proxy admits up to 16 concurrent upstream requests per process and limits each client IP to a 60-request burst refilling at 4 requests/second. Its client map is bounded to 4096 entries with idle expiry. Overload returns429 and `Retry-After:1`; limits are process-local, and clients behind a shared IP share a bucket. Asset GETs forward `If-None-Match`/`If-Modified-Since` and preserve304. Emulator routes remain absent. These limits protect the public relay and are not authentication.

Session approval on 2026-09-20 covers deployment/merge/verification and the PR 2 analytics transport switch within the approved diagnostics plan. Announce production changes first, retain the prior image, and verify real effects. This approval expires with the session. Nathan separately granted standing Matchimus staging deployment permission. Firebase/RTDB rules, DNS, gameplay fixes and deletion of other users' data remain outside the plan.
