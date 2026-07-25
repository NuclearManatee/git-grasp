import { readFileSync, existsSync } from 'node:fs';
import { verifyFileChecksum } from '../lib/checksum.js';
import { defaultDbPath, defaultThresholdsPath } from '../lib/paths.js';
import { readConfig } from '../lib/config.js';
import { openDb, loadAllRows, dbExists } from '../db/schema.js';
import { getEmbedder } from './embed.js';
import { rankResults, normalizeQuery } from './rank.js';

export function loadThresholds(path = defaultThresholdsPath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Offline semantic search. Must not use network when embeddings are cached/mock.
 */
export async function search(query, {
  dbPath = defaultDbPath(),
  thresholdsPath = defaultThresholdsPath(),
  forceMockEmbeddings = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
  skillLevelOverride = undefined,
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

  const client = await openDb(dbPath);
  const rows = await loadAllRows(client);
  client.close?.();

  const embedder = await getEmbedder({ forceMock: forceMockEmbeddings });
  const q = normalizeQuery(query, thresholds.normalizeQuery !== false);
  if (!q) {
    const err = new Error('Empty query');
    err.code = 'USAGE';
    throw err;
  }
  const embedding = await embedder.embed(q);
  const ranked = rankResults(rows, embedding, thresholds, { skillLevel });

  if (ranked.status === 'empty' && skillLevel != null) {
    const err = new Error(`No results for skill level ${skillLevel}. Try: git-help set-level clear`);
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
  // Used by tests — search.js must not import groq/env loaders that force network
  return !existsSync; // noop marker
}
