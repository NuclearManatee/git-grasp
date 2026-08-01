#!/usr/bin/env bun
// @ts-nocheck
/**
 * Postinstall: link shipped workspace packages for npm installs, verify sqlite-vec,
 * note embedding model cache behavior.
 * GIT_GRASP_SKIP_POSTINSTALL=1 ÔåÆ no-op.
 */
import { mkdirSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function linkWorkspacePackage(name, relDir) {
  const target = path.join(root, relDir);
  if (!existsSync(target)) return;
  const scopeDir = path.join(root, 'node_modules', '@git-grasp');
  mkdirSync(scopeDir, { recursive: true });
  const linkPath = path.join(scopeDir, name);
  if (existsSync(linkPath)) {
    try {
      rmSync(linkPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  symlinkSync(target, linkPath, type);
}

if (process.env.GIT_GRASP_SKIP_POSTINSTALL === '1') {
  console.log('git-grasp: postinstall skipped (GIT_GRASP_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

// Ensure `@git-grasp/common` resolves after `bun add` / `npm i` of the published tarball.
linkWorkspacePackage('common', 'common');
linkWorkspacePackage('cli', 'apps/cli');

const { smokeTestSqliteVec } = await import('@git-grasp/common');

const vec = smokeTestSqliteVec();
if (!vec.ok) {
  console.error(`git-grasp: sqlite-vec FAILED ÔÇö ${vec.reason}`);
  console.error('git-grasp: re-run `bun install` or check platform package (win32/darwin/linux)');
  process.exit(1);
}
console.log(`git-grasp: sqlite-vec OK (vec_version=${vec.version})`);

if (process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1') {
  console.log('git-grasp: mock embeddings ÔÇö no model fetch');
  process.exit(0);
}

console.log('git-grasp: model will download on first non-mock embed (Hugging Face / Xenova)');
console.log('git-grasp: telemetry is off by default; see `git-grasp telemetry status` and https://git-grasp.cremaschi.dev/privacy');
console.log('git-grasp: set GIT_GRASP_SKIP_POSTINSTALL=1 to silence this');
process.exit(0);
