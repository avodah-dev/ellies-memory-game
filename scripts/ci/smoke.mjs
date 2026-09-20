import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function smoke({ app, environment, manifest, fetchImpl = fetch }) {
  assert.ok(['matchimus', 'matchimus-preview'].includes(app));
  assert.equal(environment, app === 'matchimus' ? 'production' : 'preview');
  const origin = `https://${app}.fly.dev`;
  async function get(path) {
    const response = await fetchImpl(origin + path, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `HTTP smoke failed for ${path}`);
    return response;
  }
  const health = await (await get('/healthz')).json();
  assert.equal(health.commit, manifest.commit, 'Live build differs from the verified image');
  assert.equal(health.environment, environment);
  const configResponse = await get('/app-config.json');
  assert.equal(configResponse.headers.get('cache-control'), 'no-store');
  const config = await configResponse.json();
  assert.equal(config.environment, environment);
  assert.ok(['on', 'off'].includes(config.telemetry));
  const pingResponse = await get('/diag/ping');
  assert.equal(pingResponse.headers.get('cache-control'), 'no-store');
  assert.equal(typeof (await pingResponse.json()).now, 'number');
  const html = await (await get('/')).text();
  assert.ok(html.includes('<div id="root">'));
  const asset = html.match(/src="(\/assets\/[^"?]+\.js)"/);
  assert.ok(asset, 'Home page must reference its bundled JavaScript');
  assert.match((await get(asset[1])).headers.get('content-type'), /javascript/);
  assert.ok((await (await get('/online/game')).text()).includes('<div id="root">'));
  console.log(`Verified build ${manifest.commit} (${manifest.tree}) on ${app}: health, config, ping, SPA and JS. No Firebase or PostHog traffic.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const manifest = JSON.parse(await readFile(`${process.env.VERIFIED_IMAGE_DIR}/manifest.json`, 'utf8'));
  await smoke({ app: process.env.FLY_APP, environment: process.env.APP_ENV, manifest });
}
