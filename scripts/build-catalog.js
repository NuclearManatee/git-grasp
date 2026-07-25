#!/usr/bin/env bun
/**
 * Full catalog pipeline (resilient):
 *  0) download-docs (if missing or --refetch-docs)
 *  0b) glossary
 *  1) commands + examples + Are You Sure?
 *  1b) families + simplicity
 *  2) per-example intents
 *  3) enrich + normalize
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT } from '@git-help/core';
import { docsDir } from '@git-help/core/catalog/downloadDocs.js';

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

if (!only || only === 'glossary') run('build-catalog-glossary.js');
if (!only || only === 'commands') run('build-catalog-commands.js');
if (!only || only === 'families') run('build-catalog-families.js');
if (!only || only === 'intents') run('build-catalog-intents.js');
if (!only || only === 'enrich') run('enrich-catalog.js');
if (!only || only === 'normalize') run('build-catalog-normalize.js');

console.log('\nCatalog build pipeline finished.');
