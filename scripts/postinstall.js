#!/usr/bin/env bun
/**
 * Postinstall: verify sqlite-vec natives + note embedding model cache behavior.
 * GIT_HELP_SKIP_POSTINSTALL=1 → no-op.
 */
import { smokeTestSqliteVec } from '@git-help/core';

if (process.env.GIT_HELP_SKIP_POSTINSTALL === '1') {
  console.log('git-help: postinstall skipped (GIT_HELP_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

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
