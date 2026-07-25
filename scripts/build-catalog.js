#!/usr/bin/env node
/**
 * Full catalog pipeline (resilient):
 *  0) download-docs (if missing or --refetch-docs)
 *  1) commands + Are You Sure?
 *  2) per-command intents (no batch)
 *  3) normalize
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { docsDir } from '../src/catalog/downloadDocs.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const refetch = process.argv.includes('--refetch-docs');

function run(script) {
  console.log(`\n>>> ${script}`);
  const r = spawnSync(process.execPath, [path.join(root, script)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status === 20) process.exit(20);
  if (r.status !== 0) process.exit(r.status || 1);
}

const needDocs = refetch || !existsSync(docsDir(PACKAGE_ROOT));
if ((!only || only === 'docs' || only === 'commands') && needDocs) {
  run('download-docs.js');
} else if (only === 'docs') {
  run('download-docs.js');
}

if (!only || only === 'commands') run('build-catalog-commands.js');
if (!only || only === 'intents') run('build-catalog-intents.js');
if (!only || only === 'enrich') run('enrich-catalog.js');
if (!only || only === 'normalize') run('build-catalog-normalize.js');

console.log('\nCatalog build pipeline finished.');
