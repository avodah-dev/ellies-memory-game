import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const image = 'matchimus-verify:local';
const sha = /^[a-f0-9]{40}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
const command = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
const git = (...args) => command('git', args);
const api = (path) => JSON.parse(command('gh', ['api', path]));
const output = async (name, value) => {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
};
export const docsOnly = (paths) => paths.length > 0 && paths.every((path) =>
  path === 'README.md' || path === 'CHANGELOG.md' || /^docs\/[^\0]+\.md$/.test(path));

export function trustedRun(run, repository) {
  return run.status === 'completed' && run.conclusion === 'success' &&
    run.head_repository?.full_name === repository &&
    ((run.path === '.github/workflows/verify.yml' && ['pull_request', 'workflow_dispatch'].includes(run.event)) ||
     (run.path === '.github/workflows/deploy.yml' && ['push', 'workflow_dispatch'].includes(run.event) && ['main', 'staging'].includes(run.head_branch)));
}
export function validateManifest(manifest, tree, runCommit) {
  assert.equal(manifest.schema, 1);
  assert.match(manifest.tree, sha);
  assert.equal(manifest.tree, tree, 'Artifact source tree differs from deploy tree');
  assert.match(manifest.commit, sha);
  assert.equal(manifest.commit, runCommit, 'Build commit differs from successful workflow revision');
  assert.match(manifest.imageId, digest);
  assert.match(manifest.archiveSha256, /^[a-f0-9]{64}$/);
}
export async function archiveHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function validateImage(info, manifest) {
  assert.equal(info.Id, manifest.imageId, 'Loaded image differs from tested image');
  assert.equal(info.Os, 'linux');
  assert.equal(info.Architecture, 'amd64');
  assert.ok(info.Config.Env.includes(`APP_COMMIT=${manifest.commit}`), 'Image build revision differs');
}
const inspect = () => JSON.parse(command('docker', ['image', 'inspect', image]))[0];

export function assertVerificationResults(docs, results) {
  assert.equal(results.checks, 'success', 'Checks lane must succeed');
  for (const lane of ['vite', 'container']) {
    assert.equal(results[lane], docs ? 'skipped' : 'success', `${lane} lane has an unexpected result`);
  }
}

async function validateArchive(directory, tree, commit) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  validateManifest(manifest, tree, commit);
  assert.equal(await archiveHash(join(directory, 'image.tar.gz')), manifest.archiveSha256, 'Image archive checksum mismatch');
  return manifest;
}

async function main(mode) {
  const tree = git('rev-parse', 'HEAD^{tree}');
  const commit = git('rev-parse', 'HEAD');
  const directory = process.env.VERIFIED_IMAGE_DIR;
  await output('tree', tree);
  await output('commit', commit);
  if (mode === 'metadata') {
    let docs = false;
    if (process.env.BASE_COMMIT) {
      assert.match(process.env.BASE_COMMIT, sha);
      const files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', `${process.env.BASE_COMMIT}...HEAD`], { encoding: 'utf8' }).split('\0').filter(Boolean);
      docs = docsOnly(files);
    }
    await output('docs_only', docs);
    return;
  }
  if (mode === 'gate') {
    assert.ok(['true', 'false'].includes(process.env.DOCS_ONLY), 'Explicit docs classification required');
    assertVerificationResults(process.env.DOCS_ONLY === 'true', {
      checks: process.env.CHECKS_RESULT, vite: process.env.VITE_RESULT, container: process.env.CONTAINER_RESULT,
    });
    return;
  }
  if (mode !== 'find') assert.ok(directory, 'VERIFIED_IMAGE_DIR is required');
  if (directory) await mkdir(directory, { recursive: true });
  const archive = directory ? join(directory, 'image.tar.gz') : undefined;
  if (mode === 'validate' || mode === 'load') {
    const manifest = await validateArchive(directory, tree, commit);
    if (mode === 'load') {
      execFileSync('docker', ['load', '--input', archive], { stdio: 'inherit' });
      validateImage(inspect(), manifest);
    }
    return;
  }
  if (mode === 'save') {
    const info = inspect();
    const manifest = { schema: 1, tree, commit, imageId: info.Id };
    validateImage(info, manifest);
    execFileSync('docker', ['save', '--output', join(directory, 'image.tar'), image], { stdio: 'inherit' });
    execFileSync('gzip', ['-1', join(directory, 'image.tar')], { stdio: 'inherit' });
    manifest.archiveSha256 = await archiveHash(archive);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Saved tested image ${info.Id} for tree ${tree}`);
    return;
  }
  if (mode !== 'restore' && mode !== 'find') throw new Error('Usage: artifacts.mjs metadata|gate|save|find|restore|validate|load');
  const repository = process.env.GITHUB_REPOSITORY;
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const name = `verified-image-${tree}`;
  // Exact full-tree key includes workflows, tests, lockfile, rules and Fly config.
  // Cache absence permits a full run; API errors or corrupt evidence fail closed.
  const artifacts = api(`repos/${repository}/actions/artifacts?name=${name}&per_page=100`).artifacts;
  for (const artifact of artifacts) {
    if (artifact.expired || artifact.name !== name || !artifact.workflow_run) continue;
    const run = api(`repos/${repository}/actions/runs/${artifact.workflow_run.id}`);
    if (!trustedRun(run, repository)) continue;
    const source = api(`repos/${repository}/git/commits/${run.head_sha}`);
    if (source.tree.sha !== tree) continue;
    if (mode === 'find') {
      await output('found', 'true');
      await output('source_run', run.id);
      return;
    }
    execFileSync('gh', ['run', 'download', String(run.id), '--repo', repository, '--name', name, '--dir', directory], { stdio: 'inherit' });
    const manifest = await validateArchive(directory, tree, run.head_sha);
    execFileSync('docker', ['load', '--input', archive], { stdio: 'inherit' });
    validateImage(inspect(), manifest);
    await output('found', 'true');
    await output('build_commit', manifest.commit);
    await output('source_run', run.id);
    console.log(`Reusing verified image from run ${run.id}: build ${manifest.commit}, tree ${tree}`);
    return;
  }
  await output('found', 'false');
  console.log(`No successful retained image for tree ${tree}; full verification required`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv[2]);
}
