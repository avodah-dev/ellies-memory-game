# Firebase development setup

Use `bun run dev:local` for development and `bun run verify:local` for a fresh, isolated verification run. Both explicitly select the **demo** project `demo-matchimus`; they never select an active Firebase CLI production project.

The SDK factory in `src/lib/firebaseClient.ts` connects Auth, named Firestore database `main-firestore`, and RTDB namespace `demo-matchimus-default-rtdb` to loopback emulators. `firebase.json` loads `firestore.rules` and `database.rules.json`. The RTDB namespace is significant: testing a different emulator namespace can bypass the intended rules. Negative authorization tests guard against that mistake.

The tools require Node 24 and Java 21 or later, plus Bun 1.3.9. Browser dependencies are installed with `bunx playwright install chromium webkit` (CI adds `--with-deps`). Emulator binaries download on first use. No Firebase login or service account is needed for the demo project.

For online manual testing, use separate browser profiles/incognito windows. Normal tabs share one anonymous identity. Open the emulator UI at http://127.0.0.1:5455 to inspect local data. Test fixtures clear only the explicitly named local databases. Never point these scripts at production.

`bun run build` embeds emulator configuration; `bun run build:production` builds the Fly client, whose server requires runtime `FIREBASE_CONFIG_JSON` with `projectId`, `apiKey` and `databaseURL` (plus any other needed Firebase web configuration). The client uses anonymous auth without popup/redirect dependencies. The browser loads public configuration from `/app-config.json` before initializing Firebase. Analytics is enabled only for the production runtime environment, not preview or emulator mode. Do not copy production secrets into `.env`, scripts or docs; use Keychain/platform secret management when an authorized deployment needs credentials.

No production rule deployment, database migration, access or hosted configuration is performed by the local workflow.
