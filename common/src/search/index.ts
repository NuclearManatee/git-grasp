// @ts-nocheck
import { readFileSync, existsSync } from 'node:fs';
import { verifyFileChecksum } from '../lib/checksum.js';
import { defaultDbPath, defaultThresholdsPath } from '../lib/paths.js';
import {
  openDb,
  knnRecall,
  ftsRecall,
  loadGitVerbs,
  getRecipe,
  SCHEMA_VERSION,
  SEARCH_ALGORITHM_VERSION,
  getMetaValue,
} from '../db/schema.js';
import { parseCommands, primaryCommand, renderSnippet } from '../db/recipeFormat.js';
import { getEmbedder } from './embed.js';
import { searchHybrid, normalizeQuery } from './hybrid.js';
import {
  benchBegin,
  benchMark,
  benchEnd,
  benchStoreLast,
  benchEnabled,
} from './benchTiming.js';
import { parseJson } from '../schemas/io.js';
import { ThresholdsSchema } from '../schemas/thresholds.js';

export function loadThresholds(path = defaultThresholdsPath()) {
  return parseJson(readFileSync(path, 'utf8'), ThresholdsSchema);
}

function hydrateRecipes(db, recipeIds) {
  return recipeIds.map((id) => {
    const row = getRecipe(db, id);
    if (!row) {
      return {
        command_id: id,
        commands: [],
        example: '',
        snippet: '',
        title: '',
        description: '',
        risk: 0,
      };
    }
    const commands = parseCommands(row.commands);
    const example = primaryCommand(commands) || commands[0]?.command || '';
    return {
      command_id: String(row.id),
      recipe_id: String(row.id),
      commands,
      example,
      snippet: renderSnippet(commands),
      title: row.title || example,
      description: row.description || '',
      risk: Number(row.risk ?? 0),
      initial_state: row.initial_state ?? '',
      taxonomy_leaf: row.taxonomy_leaf,
      tags: row.tags,
    };
  });
}

/**
 * Offline hybrid search (description vec + FTS5 + confidence gate).
 */
export async function search(query, {
  dbPath = defaultDbPath(),
  thresholdsPath = defaultThresholdsPath(),
  forceMockEmbeddings = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
  skillLevelOverride = undefined,
  recallK = undefined,
  onEmbedStatus = undefined,
} = {}) {
  void skillLevelOverride;
  benchBegin();
  benchMark('start');

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
  if (!existsSync(dbPath)) {
    const err = new Error('Database missing');
    err.code = 'INTEGRITY';
    throw err;
  }

  const thresholds = loadThresholds(thresholdsPath);
  if (recallK != null) thresholds.recallK = recallK;
  benchMark('config');

  const embedder = await embedderPromise;
  benchMark('model');

  const q = normalizeQuery(query, thresholds.normalizeQuery !== false);
  if (!q) {
    const err = new Error('Empty query');
    err.code = 'USAGE';
    throw err;
  }

  const db = openDb(dbPath, { readonly: true });
  let result;
  try {
    const schemaVer = getMetaValue(db, 'schema_version');
    if (schemaVer == null || Number(schemaVer) !== SCHEMA_VERSION) {
      const err = new Error(
        `schema_version mismatch: db=${schemaVer ?? 'missing'} code=${SCHEMA_VERSION}`,
      );
      err.code = 'VERSION';
      throw err;
    }
    const algo = getMetaValue(db, 'search_algorithm_version');
    if (algo != null && Number(algo) !== SEARCH_ALGORITHM_VERSION) {
      const err = new Error(
        `search_algorithm_version mismatch: db=${algo} code=${SEARCH_ALGORITHM_VERSION}`,
      );
      err.code = 'VERSION';
      throw err;
    }
    const verbs = loadGitVerbs(db);
    result = await searchHybrid({
      query: q,
      thresholds,
      verbs,
      embed: async () => {
        const embedding = await embedder.embed(q);
        benchMark('embed');
        return embedding;
      },
      knn: (vec, k) => {
        const hits = knnRecall(db, vec, k);
        benchMark('knn');
        return hits;
      },
      fts: (qq, k) => {
        const hits = ftsRecall(db, qq, k);
        benchMark('fts');
        return hits;
      },
      hydrate: (ids) => hydrateRecipes(db, ids),
    });
  } finally {
    db.close();
  }
  benchMark('rank');

  const breakdown = benchEnd();
  if (breakdown && benchEnabled()) {
    benchStoreLast(breakdown);
  }

  return {
    ...result,
    skillFilter: null,
    embedderMock: embedder.mock,
    ...(breakdown && benchEnabled() ? { _bench: breakdown } : {}),
  };
}

export { normalizeQuery } from './hybrid.js';
export function assertOfflineSearchModule() {
  return !existsSync;
}
