// @ts-nocheck
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root from common/src/evolve */
export function repoRoot() {
  return path.resolve(here, '../../..');
}

export function evolveLocalDir(root = repoRoot()) {
  return path.join(root, 'local', 'evolve');
}

export function evolveCursorPath(root = repoRoot()) {
  return path.join(evolveLocalDir(root), 'cursor.json');
}

export function evolveStatsJsonPath(root = repoRoot()) {
  return path.join(evolveLocalDir(root), 'stats-latest.json');
}

export function evolveFeederTrainPath(root = repoRoot()) {
  return path.join(evolveLocalDir(root), 'feeder-train.json');
}

export function evolveFeederHoldoutPath(root = repoRoot()) {
  return path.join(evolveLocalDir(root), 'feeder-holdout.json');
}

export function evolveDocsLatestPath(root = repoRoot()) {
  return path.join(root, 'docs', 'evolve', 'latest.md');
}
