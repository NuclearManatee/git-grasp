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
import {
  benchBegin,
  benchMark,
  benchEnd,
  benchStoreLast,
  benchEnabled,
} from './benchTiming.js';

export function loadThresholds(path = defaultThresholdsPath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Offline semantic search. Must not use network when embeddings are cached/mock.
 * Uses sqlite-vec KNN recall, then JS re-rank (family / simplicity / specificity).
 *
 * @param {string} query
 * @param {{
 *   dbPath?: string,
 *   thresholdsPath?: string,
 *   forceMockEmbeddings?: boolean,
 *   skillLevelOverride?: number | null,
 *   recallK?: number,
 *   onEmbedStatus?: (msg: string) => void,
 * }} [opts]
 */
export async function search(query, {
  dbPath = defaultDbPath(),
  thresholdsPath = defaultThresholdsPath(),
  forceMockEmbeddings = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
  skillLevelOverride = undefined,
  recallK = undefined,
  onEmbedStatus = undefined,
} = {}) {
  benchBegin();
  benchMark('start');

  // Start model load ASAP (overlaps checksum/config).
  const embedderPromise = getEmbedder({
    forceMock: forceMockEmbeddings,
    onStatus: onEmbedStatus,
  });

  const integrity = verifyFileChecksum(dbPath);
  benchMark('checksum');
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
  benchMark('config');

  const embedder = await embedderPromise;
  benchMark('model');
  const q = normalizeQuery(query, thresholds.normalizeQuery !== false);
  if (!q) {
    const err = new Error('Empty query');
    err.code = 'USAGE';
    throw err;
  }
  const embedding = await embedder.embed(q);
  benchMark('embed');

  const topK = thresholds.topK ?? 5;
  const k = recallK ?? Math.max(DEFAULT_RECALL_K, topK * 10);

  const db = openDb(dbPath, { readonly: true });
  let candidates;
  try {
    candidates = knnRecall(db, embedding, k, {
      maxSkillLevel: skillLevel != null ? skillLevel : null,
    });
  } finally {
    db.close();
  }
  benchMark('knn');

  const ranked = rankResults(candidates, embedding, thresholds, { skillLevel, query: q });
  benchMark('rank');

  if (ranked.status === 'empty' && skillLevel != null) {
    const err = new Error(
      `No results for skill ≤ ${skillName(skillLevel)}. Try: git-help set-level clear`,
    );
    err.code = 'FILTER_EMPTY';
    throw err;
  }

  const breakdown = benchEnd();
  if (breakdown && benchEnabled()) {
    benchStoreLast(breakdown);
  }

  return {
    ...ranked,
    query: q,
    skillFilter: skillLevel,
    embedderMock: embedder.mock,
    ...(breakdown && benchEnabled() ? { _bench: breakdown } : {}),
  };
}

export function assertOfflineSearchModule() {
  return !existsSync;
}
