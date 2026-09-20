import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoke } from './smoke.mjs';
const manifest = { commit: 'a'.repeat(40), tree: 'b'.repeat(40) };
const options = { app: 'matchimus-preview', environment: 'preview', manifest };
function fixture(overrides = {}) {
  const requests = [];
  const json = (value) => new Response(JSON.stringify(value), { headers: { 'cache-control': 'no-store' } });
  const routes = {
    '/healthz': () => json({ commit: manifest.commit, environment: 'preview' }),
    '/app-config.json': () => json({ environment: 'preview', telemetry: 'on' }),
    '/diag/ping': () => json({ now: Date.now() }),
    '/': () => new Response('<div id="root"></div><script src="/assets/main.js"></script>'),
    '/assets/main.js': () => new Response('console.log("asset")', { headers: { 'content-type': 'application/javascript' } }),
    '/online/game': () => new Response('<div id="root"></div>'),
    ...overrides,
  };
  return { requests, fetchImpl: async (url, init) => {
    assert.equal(new URL(url).origin, 'https://matchimus-preview.fly.dev');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal);
    requests.push(new URL(url).pathname);
    return routes[new URL(url).pathname]();
  } };
}
test('HTTP smoke checks the tested build and static serving without executing app/SDK', async () => {
  const { requests, fetchImpl } = fixture();
  await smoke({ ...options, fetchImpl });
  assert.deepEqual(requests, ['/healthz', '/app-config.json', '/diag/ping', '/', '/assets/main.js', '/online/game']);
});
test('wrong revision and missing static assets fail smoke', async () => {
  for (const overrides of [
    { '/healthz': () => Response.json({ commit: 'wrong', environment: 'preview' }) },
    { '/assets/main.js': () => new Response('', { status: 404 }) },
    { '/diag/ping': () => Response.json({ now: Date.now() }) },
  ]) await assert.rejects(smoke({ ...options, fetchImpl: fixture(overrides).fetchImpl }));
});
test('app/environment mismatch is rejected before requesting a live endpoint', async () => {
  const { requests, fetchImpl } = fixture();
  await assert.rejects(smoke({ ...options, environment: 'production', fetchImpl }));
  assert.equal(requests.length, 0);
});
