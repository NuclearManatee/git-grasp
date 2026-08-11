/**
 * Browser / WASM web catalog handle + hybrid searchBrowser.
 * Uses sql.js (WASM SQLite+FTS5) + JS KNN over recipe_embeddings.
 */
// @ts-nocheck
import {
  DEFAULT_RECALL_K,
  SEARCH_ALGORITHM_VERSION,
  SCHEMA_VERSION,
  EMBEDDING_DIM,
} from '../db/constants.js';
import { ThresholdsSchema } from '../schemas/thresholds.js';
import { parseGitVerbsMeta } from './gitVerbs.js';
import { buildFtsMatchQuery } from './ftsQuery.js';
import { jsKnn } from './jsKnn.js';
import { searchHybrid, normalizeQuery } from './hybrid.js';
import { getBrowserEmbedder } from './embed.browser.js';
import { parseCommands, primaryCommand, renderSnippet } from '../db/recipeFormat.js';
import { distanceToSimilarity } from '../db/utils.js';

/** @type {WebCatalogHandle | null} */
let cachedCatalog = null;

export async function sha256Hex(bytes) {
  const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function metaGet(db, key) {
  const stmt = db.prepare('SELECT value FROM meta WHERE key = ?');
  stmt.bind([key]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row.value;
  }
  stmt.free();
  return null;
}

function loadEmbeddings(db) {
  const embeddings = [];
  for (const table of ['recipe_embeddings', 'intent_embeddings']) {
    try {
      const embStmt = db.prepare(`SELECT id, embedding FROM ${table}`);
      while (embStmt.step()) {
        const row = embStmt.getAsObject();
        const buf = row.embedding instanceof Uint8Array
          ? row.embedding
          : new Uint8Array(row.embedding);
        const floats = new Float32Array(
          buf.buffer,
          buf.byteOffset,
          Math.floor(buf.byteLength / 4),
        );
        if (floats.length >= EMBEDDING_DIM) {
          embeddings.push({
            id: String(row.id),
            embedding: floats.subarray(0, EMBEDDING_DIM),
          });
        }
      }
      embStmt.free();
      if (embeddings.length) return embeddings;
    } catch {
      /* try next table */
    }
  }
  return embeddings;
}

/**
 * Open web catalog DB bytes (sql.js WASM). Requires expectedSha256.
 */
export async function openWebCatalog(data, { expectedSha256, initSqlJs } = {}) {
  if (
    typeof expectedSha256 !== 'string'
    || !/^[a-fA-F0-9]{64}$/.test(expectedSha256)
  ) {
    const err = new Error('Web catalog integrity check required: expectedSha256 (64 hex)');
    err.code = 'INTEGRITY';
    throw err;
  }
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const expected = expectedSha256.toLowerCase();
  const actual = await sha256Hex(bytes);
  if (actual !== expected) {
    const err = new Error('Web catalog integrity check failed: mismatch');
    err.code = 'INTEGRITY';
    err.detail = { expected, actual };
    throw err;
  }

  const SQL = initSqlJs
    ? await initSqlJs()
    : await (async () => {
        const mod = await import('sql.js');
        const factory = mod.default || mod;
        return factory({
          // Prefer same-origin WASM (CSP-friendly). Avoid `new URL(..., import.meta.url)`
          // — Vite treats dynamic paths as import.glob.
          locateFile: (file) => `/vendor/sql.js/${file}`,
        });
      })();

  const db = new SQL.Database(bytes);
  const schemaVersion = Number(metaGet(db, 'schema_version') || 0);
  const searchAlgorithmVersion = Number(
    metaGet(db, 'search_algorithm_version') || 0,
  );
  if (schemaVersion !== SCHEMA_VERSION) {
    const err = new Error(
      `schema_version mismatch: catalog=${schemaVersion} code=${SCHEMA_VERSION}`,
    );
    err.code = 'VERSION';
    throw err;
  }
  if (searchAlgorithmVersion !== SEARCH_ALGORITHM_VERSION) {
    const err = new Error(
      `search_algorithm_version mismatch: catalog=${searchAlgorithmVersion} code=${SEARCH_ALGORITHM_VERSION}`,
    );
    err.code = 'VERSION';
    throw err;
  }

  const thrRaw = metaGet(db, 'thresholds_json');
  const thresholds = thrRaw
    ? ThresholdsSchema.parse(JSON.parse(thrRaw))
    : ThresholdsSchema.parse({
        schemaVersion: 5,
        topK: 3,
        recallK: DEFAULT_RECALL_K,
        confidenceVeryHigh: 0.9,
        confidenceHigh: 0.75,
        confidenceMedium: 0.4,
        normalizeQuery: true,
      });

  const verbs = parseGitVerbsMeta(metaGet(db, 'git_verbs'));
  const embeddings = loadEmbeddings(db);
  const corpusRaw = metaGet(db, 'corpus_version');
  const catalogVersion =
    corpusRaw != null && corpusRaw !== '' && Number.isFinite(Number(corpusRaw))
      ? Number(corpusRaw)
      : null;

  /** @type {WebCatalogHandle} */
  const handle = {
    kind: 'web-catalog',
    thresholds,
    schemaVersion,
    searchAlgorithmVersion,
    catalogVersion,
    verbs,
    embeddings,
    db,
    sha256: expected,
  };
  cachedCatalog = handle;
  return handle;
}

/** @deprecated use openWebCatalog */
export async function openWebPack(data, opts) {
  return openWebCatalog(data, opts);
}

export function getOpenWebPack() {
  return cachedCatalog;
}

export function getOpenWebCatalog() {
  return cachedCatalog;
}

export function resetWebPackForTests() {
  if (cachedCatalog?.db) {
    try {
      cachedCatalog.db.close();
    } catch {
      /* */
    }
  }
  cachedCatalog = null;
}

function ftsRecallSqlJs(db, query, k) {
  const match = buildFtsMatchQuery(query);
  if (!match) return [];
  try {
    const stmt = db.prepare(
      `
      SELECT recipe_id AS recipe_id, bm25(recipes_fts) AS bm25
      FROM recipes_fts
      WHERE recipes_fts MATCH ?
      ORDER BY bm25
      LIMIT ?
      `,
    );
    stmt.bind([match, k]);
    const out = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      out.push({
        recipe_id: String(row.recipe_id),
        command_id: String(row.recipe_id),
        bm25: Number(row.bm25),
      });
    }
    stmt.free();
    return out;
  } catch {
    return [];
  }
}

function knnFromCatalog(catalog, embedding, k) {
  const hits = jsKnn(embedding, catalog.embeddings, k);
  const out = [];
  for (const h of hits) {
    const stmt = catalog.db.prepare('SELECT * FROM recipes WHERE id = ?');
    stmt.bind([String(h.id)]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      const commands = parseCommands(row.commands);
      out.push({
        command_id: String(row.id),
        recipe_id: String(row.id),
        title: row.title,
        description: row.description,
        intent_text: row.description,
        _forcedScore: distanceToSimilarity(h.distance),
        commands,
        risk: Number(row.risk ?? 0),
        example: primaryCommand(commands) || '',
        snippet: renderSnippet(commands),
      });
    }
    stmt.free();
  }
  return out;
}

function hydrateFromCatalog(catalog, recipeIds) {
  return recipeIds.map((id) => {
    const stmt = catalog.db.prepare(
      'SELECT id, commands, title, description, risk FROM recipes WHERE id = ?',
    );
    stmt.bind([String(id)]);
    if (!stmt.step()) {
      stmt.free();
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
    const row = stmt.getAsObject();
    stmt.free();
    const commands = parseCommands(row.commands);
    return {
      command_id: String(row.id),
      commands,
      example: primaryCommand(commands) || '',
      snippet: renderSnippet(commands),
      title: row.title || '',
      description: row.description || '',
      risk: Number(row.risk ?? 0),
    };
  });
}

/**
 * Isofunctional hybrid search in the browser.
 */
export async function searchBrowser(query, {
  pack = cachedCatalog,
  catalog = cachedCatalog,
  forceMockEmbeddings = false,
  skillLevelOverride = null,
  recallK = undefined,
  onEmbedStatus = undefined,
} = {}) {
  void skillLevelOverride;
  const handle = catalog || pack;
  if (!handle || handle.kind !== 'web-catalog') {
    const err = new Error('Web catalog not loaded. Call openWebCatalog first.');
    err.code = 'INTEGRITY';
    throw err;
  }

  const embedder = await getBrowserEmbedder({
    forceMock: forceMockEmbeddings,
    onStatus: onEmbedStatus,
  });

  const thresholds = { ...handle.thresholds };
  if (recallK != null) thresholds.recallK = recallK;

  const q = normalizeQuery(query, thresholds.normalizeQuery !== false);
  if (!q) {
    const err = new Error('Empty query');
    err.code = 'USAGE';
    throw err;
  }

  const result = await searchHybrid({
    query: q,
    thresholds,
    verbs: handle.verbs,
    embed: async () => embedder.embed(q),
    knn: (vec, k) => knnFromCatalog(handle, vec, k),
    fts: (qq, k) => ftsRecallSqlJs(handle.db, qq, k),
    hydrate: (ids) => hydrateFromCatalog(handle, ids),
  });

  return {
    ...result,
    skillFilter: null,
    embedderMock: embedder.mock,
  };
}
