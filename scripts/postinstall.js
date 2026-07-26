#!/usr/bin/env bun
/**
 * Postinstall: link shipped workspace packages for npm installs, verify sqlite-vec,
 * note embedding model cache behavior.
 * GIT_HELP_SKIP_POSTINSTALL=1 → no-op.
 */
import { mkdirSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function linkWorkspacePackage(name, relDir) {
  const target = path.join(root, relDir);
  if (!existsSync(target)) return;
  const scopeDir = path.join(root, 'node_modules', '@git-help');
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

if (process.env.GIT_HELP_SKIP_POSTINSTALL === '1') {
  console.log('git-help: postinstall skipped (GIT_HELP_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

// Ensure `@git-help/core` resolves after `bun add` / `npm i` of the published tarball.
linkWorkspacePackage('core', 'packages/core');
linkWorkspacePackage('cli', 'apps/cli');

const { smokeTestSqliteVec } = await import('@git-help/core');

const vec = smokeTestSqliteVec();
if (!vec.ok) {
  console.error(`git-help: sqlite-vec FAILED — ${vec.reason}`);
  console.error('git-help: re-run `bun install` or check platform package (win32/darwin/linux)');
  process.exit(1);
}
console.log(`git-help: sqlite-vec OK (vec_version=${vec.version})`);

if (process.env.GIT_HELP_MOCK_EMBEDDINGS === '1') {
  console.log('git-help: mock embeddings — no model fetch');
  process.exit(0);
}

console.log('git-help: model will download on first non-mock embed (Hugging Face / Xenova)');
console.log('git-help: set GIT_HELP_SKIP_POSTINSTALL=1 to silence this');
process.exit(0);
