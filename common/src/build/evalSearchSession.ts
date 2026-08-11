// @ts-nocheck
/**
 * Readonly eval search session (connection pool) for bank eval / gap-check.
 * Shared so recovery can open a session without importing orchestrator (cycle).
 */
import {
  openDb,
  getRecipe,
  knnRecall,
  ftsRecall,
  loadGitVerbs,
  finalizeSearchIndex,
} from '../db/schema.js';
import { EVAL_SEARCH_POOL_SIZE } from '../db/constants.js';
import { defaultThresholdsPath } from '../lib/paths.js';
import { getEmbedder } from '../search/embed.js';
import { parseCommands, primaryCommand, renderSnippet } from '../db/recipeFormat.js';
import { searchHybrid } from '../search/hybrid.js';
import { loadThresholds } from '../search/index.js';
import { recipeIdOf } from './evalGate.js';

/** Serialize async work (bun:sqlite connection is not concurrent-safe). */
function createAsyncMutex() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(() => fn(), () => fn());
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

function defaultSearchThresholds() {
  try {
    return loadThresholds(defaultThresholdsPath());
  } catch {
    return {
      schemaVersion: 5,
      topK: 3,
      recallK: 100,
      confidenceVeryHigh: 0.9,
      confidenceHigh: 0.75,
      confidenceMedium: 0.4,
      normalizeQuery: true,
    };
  }
}

/** Resolve readonly eval search pool size (opts > env > default). */
export function resolveEvalSearchPoolSize(opts = {}) {
  if (opts.poolSize != null && Number.isFinite(Number(opts.poolSize))) {
    return Math.max(1, Math.floor(Number(opts.poolSize)));
  }
  const env = process.env.GIT_GRASP_EVAL_SEARCH_POOL;
  if (env != null && String(env).trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return EVAL_SEARCH_POOL_SIZE;
}

/**
 * One eval session: finalize FTS/verbs once, then open a readonly connection pool.
 * Local embed is mutex-serialized; each RO conn has its own mutex for sqlite.
 * @param {string} dbPath
 * @returns {Promise<{ search: (query: string) => Promise<*>, close: () => void, poolSize: number }>}
 */
export async function makeEvalSearchSession(dbPath, opts = {}) {
  const embedder = await getEmbedder({
    forceMock: process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
  });
  const thresholds = defaultSearchThresholds();
  const poolSize = resolveEvalSearchPoolSize(opts);

  // Finalize index on a writable handle, then close it so readers see a stable file.
  const writeDb = openDb(dbPath, { readonly: false });
  finalizeSearchIndex(writeDb);
  const verbs = loadGitVerbs(writeDb);
  writeDb.close();

  const withEmbed = createAsyncMutex();
  /** @type {{ db: *, withDb: (fn: Function) => Promise<*> }[]} */
  const pool = [];
  for (let i = 0; i < poolSize; i += 1) {
    const db = openDb(dbPath, { readonly: true });
    pool.push({ db, withDb: createAsyncMutex() });
  }

  let cursor = 0;
  const acquireSlot = () => {
    const slot = pool[cursor % pool.length];
    cursor += 1;
    return slot;
  };

  const search = async (query) => {
    const vec = await withEmbed(async () => embedder.embed(query));
    const slot = acquireSlot();
    return slot.withDb(async () => {
      const db = slot.db;
      return searchHybrid({
        query,
        thresholds,
        preferredSkillOverride: null,
        verbs,
        embed: async () => vec,
        knn: (v, k) => knnRecall(db, v, k),
        fts: (q, k) => ftsRecall(db, q, k),
        hydrate: (ids) =>
          ids.map((id) => {
            const row = getRecipe(db, id);
            if (!row) {
              return {
                command_id: String(id),
                recipe_id: String(id),
                commands: [],
                example: '',
                snippet: '',
                risk: 0,
              };
            }
            const commands = parseCommands(row.commands);
            const rid = recipeIdOf(row);
            return {
              command_id: rid,
              recipe_id: rid,
              commands,
              example: primaryCommand(commands) || '',
              snippet: renderSnippet(commands),
              risk: Number(row.risk ?? 0),
            };
          }),
      });
    });
  };

  return {
    search,
    poolSize,
    close() {
      for (const slot of pool) {
        try {
          slot.db.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
