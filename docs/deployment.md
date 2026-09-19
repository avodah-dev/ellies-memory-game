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
