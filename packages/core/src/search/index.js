import { readFileSync, existsSync } from 'node:fs';
import { verifyFileChecksum } from '../lib/checksum.js';
import { defaultDbPath, defaultThresholdsPath } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { skillName } from '../lib/skills.js';
import {
  openDb,
  knnRecall,
  dbExists,
  DEFAULT_RECALL_K,
} from '../db/schema.js';
import { getEmbedder } from './embed.js';
import { rankResults, normalizeQuery } from './rank.js';

export function loadThresholds(path = defaultThresholdsPath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Offline semantic search. Must not use network when embeddings are cached/mock.
 * Uses sqlite-vec KNN recall, then JS re-rank (family / simplicity / specificity).
 */
export async function search(query, {
  dbPath = defaultDbPath(),
  thresholdsPath = defaultThresholdsPath(),
  forceMockEmbeddings = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
  skillLevelOverride = undefined,
  recallK = undefined,
} = {}) {
  const integrity = verifyFileChecksum(dbPath);
  if (!integrity.ok) {
    const err = new Error(`Database integrity check failed: ${integrity.reason}`);
    err.code = 'INTEGRITY';
    err.detail = integrity;
    throw err;
  }
  if (!dbExists(dbPath)) {
    const err = new Error('Database missing');
    err.code = 'INTEGRITY';
    throw err;
  }

  const thresholds = loadThresholds(thresholdsPath);
  let skillLevel = skillLevelOverride;
  if (skillLevel === undefined) {
    try {
      skillLevel = readConfig().skillLevel;
    } catch (e) {
      if (e.code === 'CONFIG_INSECURE') {
        const err = new Error(e.message);
        err.code = 'CONFIG';
        throw err;
      }
      throw e;
    }
  }

  const embedder = await getEmbedder({ forceMock: forceMockEmbeddings });
  const q = normalizeQuery(query, thresholds.normalizeQuery !== false);
  if (!q) {
    const err = new Error('Empty query');
    err.code = 'USAGE';
    throw err;
  }
  const embedding = await embedder.embed(q);

  const topK = thresholds.topK ?? 5;
  const k = recallK ?? Math.max(DEFAULT_RECALL_K, topK * 10);

  const db = openDb(dbPath, { readonly: true });
  let candidates;
  try {
    candidates = knnRecall(db, embedding, k);
  } finally {
    db.close();
  }

  const ranked = rankResults(candidates, embedding, thresholds, { skillLevel });

  if (ranked.status === 'empty' && skillLevel != null) {
    const err = new Error(
      `No results for skill ≤ ${skillName(skillLevel)}. Try: git-help set-level clear`,
    );
    err.code = 'FILTER_EMPTY';
    throw err;
  }

  return {
    ...ranked,
    query: q,
    skillFilter: skillLevel,
    embedderMock: embedder.mock,
  };
}

export function assertOfflineSearchModule() {
  return !existsSync;
}
