#!/usr/bin/env bun
// @ts-nocheck
/**
 * CI / release regression gate: load eval/regression.json, search default DB,
 * exit 0 if accuracy ≥ minAccuracy (default 0.95), else 1.
 *
 * Usage:
 *   bun apps/pipeline/src/eval/regression-gate.ts
 *   bun run eval:regression -- --min-accuracy=0.95
 *
 * CI release/eval workflows use real embeddings (mock KNN fails the 0.95 gate).
 * Pass --mock-embed or GIT_GRASP_MOCK_EMBEDDINGS=1 only for local smoke timing.
 */
import { existsSync } from 'node:fs';
import { search, defaultDbPath } from '@git-grasp/common';
import {
  loadRegressionSet,
  evaluateRegressionSet,
  regressionSetPath,
} from '../../../../common/src/build/regressionSet.ts';

const args = process.argv.slice(2);
const minAccuracy = Number(
  args.find((a) => a.startsWith('--min-accuracy='))?.split('=')[1] ?? '0.95',
);
const forceMock =
  process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1' || args.includes('--mock-embed');

const setPath = regressionSetPath();
const dbPath = defaultDbPath();

if (!existsSync(setPath)) {
  console.error(`Regression set missing: ${setPath}`);
  process.exit(1);
}
if (!existsSync(dbPath)) {
  console.error(`Catalog DB missing: ${dbPath}. Run bun run ship first.`);
  process.exit(1);
}

const set = loadRegressionSet(setPath);
if (!set.queries?.length) {
  console.error(`Regression set empty: ${setPath}`);
  process.exit(1);
}

async function searchFn(query) {
  return search(query, { forceMockEmbeddings: forceMock, dbPath });
}

const result = await evaluateRegressionSet(set, {
  search: searchFn,
  minAccuracy,
  minTotal: 1,
});

const summary = {
  ok: result.ok,
  accuracy: result.accuracy,
  hits: result.hits,
  total: result.total,
  minAccuracy,
  db: dbPath,
  regression: setPath,
  version: set.version,
  mockEmbeddings: forceMock,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(result.ok ? 0 : 1);
