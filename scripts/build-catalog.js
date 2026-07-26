#!/usr/bin/env bun
/**
 * Recipe catalog pipeline (schema v5):
 *  0) ingest sources (cheat sheet, tldr, progit, git-scm docs, man oracle)
 *  1) synthesize recipes
 *  2) assign families
 *  3) generate intents
 *  4) enrich + normalize → recipes.json + intents.jsonl
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const refetch = process.argv.includes('--refetch-docs');
const fixtures = process.argv.includes('--fixtures');

function run(script, args = []) {
  console.log(`\n>>> ${script} ${args.join(' ')}`);
  const r = spawnSync(process.execPath, [path.join(root, script), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status === 20) process.exit(20);
  if (r.status !== 0) process.exit(r.status || 1);
}

if (fixtures) {
  run('build-catalog-fixtures.js');
  console.log('\nFixture catalog written.');
  process.exit(0);
}

if (!only || only === 'ingest' || only === 'sources') {
  run('ingest-sources.js', refetch ? ['--refetch-docs'] : []);
}
if (!only || only === 'recipes') run('build-catalog-recipes.js');
if (!only || only === 'families') run('build-catalog-recipe-families.js');
if (!only || only === 'intents') run('build-catalog-recipe-intents.js');
if (!only || only === 'enrich') run('enrich-recipe-catalog.js');
if (!only || only === 'normalize') run('build-catalog-recipe-normalize.js');

console.log('\nRecipe catalog build pipeline finished.');
