import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveHash, assertVerificationResults, docsOnly, trustedRun, validateImage, validateManifest } from './artifacts.mjs';
const repository = 'avodah-dev/ellies-memory-game';
const tree = 'a'.repeat(40);
const commit = 'b'.repeat(40);
const manifest = { schema: 1, tree, commit, imageId: `sha256:${'c'.repeat(64)}`, archiveSha256: 'd'.repeat(64) };
const run = { status: 'completed', conclusion: 'success', head_repository: { full_name: repository }, path: '.github/workflows/verify.yml', event: 'pull_request' };
test('aggregate requires every full-suite lane; docs-only permits only explicit browser skips', () => {
  const full = { checks: 'success', vite: 'success', container: 'success' };
  assertVerificationResults(false, full);
  assertVerificationResults(true, { checks: 'success', vite: 'skipped', container: 'skipped' });
  for (const lane of Object.keys(full)) {
    for (const result of ['failure', 'cancelled', 'skipped', '', undefined]) {
      assert.throws(() => assertVerificationResults(false, { ...full, [lane]: result }));
    }
  }
  assert.throws(() => assertVerificationResults(true, full));
  assert.throws(() => assertVerificationResults(true, { checks: 'skipped', vite: 'skipped', container: 'skipped' }));
  assert.throws(() => assertVerificationResults(true, { checks: 'success', vite: 'failure', container: 'skipped' }));
});
test('docs-only excludes code, CI, lockfiles, rules, deletions/renames into code', () => {
  assert.equal(docsOnly(['README.md', 'docs/deployment.md']), true);
  for (const file of ['src/App.tsx', 'bun.lock', 'firestore.rules', '.github/workflows/verify.yml', 'Dockerfile', 'docs/example.ts', 'fly.toml']) {
    assert.equal(docsOnly(['README.md', file]), false);
  }
  assert.equal(docsOnly([]), false);
});
test('only completed successful verification or release runs from this repository qualify', () => {
  assert.equal(trustedRun(run, repository), true);
  assert.equal(trustedRun({ ...run, path: '.github/workflows/deploy.yml', event: 'push', head_branch: 'staging' }, repository), true);
  for (const change of [
    { status: 'in_progress' }, { conclusion: 'failure' }, { conclusion: 'cancelled' },
    { head_repository: { full_name: 'attacker/fork' } }, { path: '.github/workflows/other.yml' },
    { event: 'pull_request_target' }, { path: '.github/workflows/deploy.yml', event: 'push', head_branch: 'feature' },
  ]) assert.equal(trustedRun({ ...run, ...change }, repository), false);
});
test('tree reuse allows merge SHA differences but never a different tree or producing revision', () => {
  validateManifest(manifest, tree, commit);
  assert.throws(() => validateManifest(manifest, 'e'.repeat(40), commit));
  assert.throws(() => validateManifest(manifest, tree, 'f'.repeat(40)));
  for (const change of [{ schema: 2 }, { imageId: 'latest' }, { archiveSha256: '' }, { commit: '../bad' }]) {
    assert.throws(() => validateManifest({ ...manifest, ...change }, tree, commit));
  }
});
test('loaded image must match content ID, platform and baked-in build commit', () => {
  const info = { Id: manifest.imageId, Os: 'linux', Architecture: 'amd64', Config: { Env: [`APP_COMMIT=${commit}`] } };
  validateImage(info, manifest);
  for (const change of [{ Id: `sha256:${'e'.repeat(64)}` }, { Architecture: 'arm64' }, { Os: 'windows' }, { Config: { Env: ['APP_COMMIT=other'] } }]) {
    assert.throws(() => validateImage({ ...info, ...change }, manifest));
  }
});
test('archive checksum detects altered bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'matchimus-artifact-'));
  try {
    const path = join(dir, 'image');
    await writeFile(path, 'verified bytes');
    const hash = await archiveHash(path);
    await writeFile(path, 'modified bytes');
    assert.notEqual(await archiveHash(path), hash);
  } finally { await rm(dir, { recursive: true }); }
});
test('actual metadata command treats a source-to-docs rename as a code change', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { mkdir, readFile, rename } = await import('node:fs/promises');
  const dir = await mkdtemp(join(tmpdir(), 'matchimus-docs-filter-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    await writeFile(join(dir, 'source.ts'), 'export const value = 1;\n');
    git('add', '.'); git('commit', '-qm', 'source');
    const base = git('rev-parse', 'HEAD');
    await mkdir(join(dir, 'docs'));
    await rename(join(dir, 'source.ts'), join(dir, 'docs', 'source.md'));
    git('add', '-A'); git('commit', '-qm', 'rename');
    const output = join(dir, 'output');
    execFileSync(process.execPath, [fileURLToPath(new URL('./artifacts.mjs', import.meta.url)), 'metadata'], {
      cwd: dir, env: { ...process.env, BASE_COMMIT: base, GITHUB_OUTPUT: output },
    });
    const result = await readFile(output, 'utf8');
    assert.ok(result.includes('docs_only=false'));
    assert.ok(result.includes(`tree=${git('rev-parse', 'HEAD^{tree}')}`));
  } finally { await rm(dir, { recursive: true }); }
});
test('qualification validates current revision and bytes before publishing the candidate', async () => {
  const { execFileSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'matchimus-candidate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
    git('commit', '--allow-empty', '-qm', 'candidate');
    const archive = join(dir, 'image.tar.gz');
    await writeFile(archive, 'tested image bytes');
    const valid = { ...manifest, tree: git('rev-parse', 'HEAD^{tree}'), commit: git('rev-parse', 'HEAD'), archiveSha256: await archiveHash(archive) };
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(valid));
    const validate = () => execFileSync(process.execPath, [fileURLToPath(new URL('./artifacts.mjs', import.meta.url)), 'validate'], {
      cwd: dir, env: { ...process.env, VERIFIED_IMAGE_DIR: dir }, stdio: 'pipe',
    });
    validate();
    await writeFile(archive, 'corrupt image bytes');
    assert.throws(validate);
    await writeFile(archive, 'tested image bytes');
    git('commit', '--allow-empty', '-qm', 'different producing revision');
    assert.throws(validate);
  } finally { await rm(dir, { recursive: true }); }
});
