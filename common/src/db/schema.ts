// @ts-nocheck
/**
 * Catalog SQLite schema v9 — recipes + description embeddings + FTS.
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, copyFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import {
  SCHEMA_VERSION,
  EMBEDDING_DIM,
  DEFAULT_RECALL_K,
  SEARCH_ALGORITHM_VERSION,
} from './constants.js';
import { normalizeUsage, cosineSimilarity, distanceToSimilarity } from './utils.js';
import {
  serializeCommandRecipe,
  parseCommands,
  renderSnippet,
  primaryCommand,
} from './recipeFormat.js';
import { buildFtsMatchQuery, recipeFtsBody } from '../search/ftsQuery.js';
import {
  collectGitVerbsFromRecipes,
  serializeGitVerbsMeta,
  parseGitVerbsMeta,
} from '../search/gitVerbs.js';
import { createHash } from 'node:crypto';
import { structuralCommandFingerprint } from '../build/argvNormalize.js';

export {
  SCHEMA_VERSION,
  EMBEDDING_DIM,
  DEFAULT_RECALL_K,
  SEARCH_ALGORITHM_VERSION,
};
export { normalizeUsage, cosineSimilarity, distanceToSimilarity };
export {
  serializeCommandRecipe,
  parseCommands,
  renderSnippet,
  primaryCommand,
  serializeCommands,
} from './recipeFormat.js';

export const DDL = `
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  commands TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  taxonomy_leaf TEXT NOT NULL,
  paraphrases TEXT NOT NULL DEFAULT '[]',
  provenance TEXT NOT NULL CHECK (provenance IN ('synthetic','real-failure-seeded','gap-filled')),
  validated INTEGER NOT NULL DEFAULT 0,
  initial_state TEXT NOT NULL DEFAULT '',
  command_fingerprint TEXT NOT NULL,
  initial_state_physical_hash TEXT NOT NULL DEFAULT '',
  final_state_physical_hash TEXT NOT NULL DEFAULT '',
  risk REAL NOT NULL CHECK (risk >= 0 AND risk <= 1)
);
CREATE INDEX IF NOT EXISTS idx_recipes_leaf ON recipes(taxonomy_leaf);
CREATE INDEX IF NOT EXISTS idx_recipes_fingerprint ON recipes(command_fingerprint);
CREATE INDEX IF NOT EXISTS idx_recipes_hash_pair ON recipes(initial_state_physical_hash, final_state_physical_hash);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_recipes USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
  recipe_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

function maybeSetCustomSqlite() {
  if (process.platform !== 'darwin') return;
  const candidates = [
    process.env.GIT_GRASP_SQLITE_LIB,
    '/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite/lib/libsqlite3.dylib',
    '/usr/local/opt/sqlite3/lib/libsqlite3.dylib',
  ].filter(Boolean);
  for (const lib of candidates) {
    if (existsSync(lib)) {
      try {
        Database.setCustomSQLite(lib);
        return lib;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

export function loadSqliteVec(db) {
  maybeSetCustomSqlite();
  sqliteVec.load(db);
  const row = db.prepare('SELECT vec_version() AS v').get();
  if (!row?.v) {
    throw new Error('sqlite-vec loaded but vec_version() returned empty');
  }
  return String(row.v);
}

export function openDb(dbPath, { readonly = false } = {}) {
  if (dbPath !== ':memory:' && !readonly) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath, readonly ? { readonly: true } : undefined);
  if (!readonly) {
    db.exec('PRAGMA journal_mode = DELETE;');
  }
  loadSqliteVec(db);
  if (!readonly) {
    ensureSchemaV9(db);
  }
  return db;
}

export function openCatalog(dbPath) {
  const db = openDb(dbPath);
  return {
    path: dbPath,
    schemaVersion: SCHEMA_VERSION,
    _db: db,
    close() {
      db.close();
    },
  };
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
    .all()
    .map((r) => r.name);
}

function dropAllCatalogTables(db) {
  for (const t of [
    'recipes_fts',
    'commands_fts',
    'vec_recipes',
    'vec_intents',
    'vec_commands',
    'intents',
    'commands',
    'recipes',
    'search_intents',
    'git_commands',
    'meta',
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  }
}

function ensureSchemaV9(db) {
  const tables = tableNames(db);
  const hasRecipes = tables.includes('recipes');
  const hasVec = tables.includes('vec_recipes');
  const hasLegacy =
    tables.includes('commands') ||
    tables.includes('intents') ||
    tables.includes('vec_intents') ||
    tables.includes('search_intents') ||
    tables.includes('git_commands');

  if (hasLegacy || !hasRecipes || !hasVec) {
    dropAllCatalogTables(db);
    db.exec(DDL);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    );
    return;
  }

  const ver = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (!ver || Number(ver.value) !== SCHEMA_VERSION) {
    dropAllCatalogTables(db);
    db.exec(DDL);
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    );
    return;
  }

  if (!tables.includes('recipes_fts')) {
    db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
  recipe_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);
  }
}

function parseJsonArray(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function deriveCommandFamily(example) {
  const parts = String(example || '').trim().split(/\s+/);
  if (parts[0] === 'git' && parts[1] && !parts[1].startsWith('-')) {
    return `git ${parts[1]}`;
  }
  return parts[0] === 'git' ? 'git' : String(example || '').trim();
}

/** Canonical template fingerprint for recipe argv (placeholders + demo literals normalized). */
export function commandFingerprint(commands) {
  return structuralCommandFingerprint(commands);
}

function rowToRecipe(r) {
  if (!r) return null;
  const commands = parseCommands(r.commands);
  return {
    id: String(r.id),
    commands,
    title: String(r.title || ''),
    description: String(r.description || ''),
    tags: parseJsonArray(r.tags),
    taxonomy_leaf: String(r.taxonomy_leaf || ''),
    paraphrases: parseJsonArray(r.paraphrases),
    provenance: r.provenance || 'synthetic',
    validated: Boolean(r.validated),
    initial_state: String(r.initial_state || ''),
    command_fingerprint: String(r.command_fingerprint || ''),
    initial_state_physical_hash: String(r.initial_state_physical_hash || ''),
    final_state_physical_hash: String(r.final_state_physical_hash || ''),
    risk: Number(r.risk ?? 0),
  };
}

/**
 * Insert or replace a recipe. Optionally writes description embedding to vec_recipes.
 * @returns {string} recipe id
 */
export function insertRecipe(clientOrCatalog, recipe, embedding = null) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const id = String(recipe.id);
  const commandsJson = serializeCommandRecipe({
    commands: parseCommands(recipe.commands),
  });
  const fp =
    recipe.command_fingerprint ||
    commandFingerprint(recipe.commands);
  const tags = JSON.stringify(Array.isArray(recipe.tags) ? recipe.tags : []);
  const paraphrases = JSON.stringify(
    Array.isArray(recipe.paraphrases) ? recipe.paraphrases : [],
  );

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT OR REPLACE INTO recipes (
        id, commands, title, description, tags, taxonomy_leaf, paraphrases,
        provenance, validated, initial_state, command_fingerprint,
        initial_state_physical_hash, final_state_physical_hash, risk
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      commandsJson,
      String(recipe.title || '').trim(),
      String(recipe.description || '').trim(),
      tags,
      String(recipe.taxonomy_leaf || ''),
      paraphrases,
      recipe.provenance || 'synthetic',
      recipe.validated ? 1 : 0,
      String(recipe.initial_state || ''),
      fp,
      String(recipe.initial_state_physical_hash || ''),
      String(recipe.final_state_physical_hash || ''),
      Number(recipe.risk ?? 0),
    );

    if (embedding) {
      const emb =
        embedding instanceof Float32Array
          ? embedding
          : new Float32Array(embedding);
      if (emb.length !== EMBEDDING_DIM) {
        throw new Error(`embedding dim ${emb.length} !== ${EMBEDDING_DIM}`);
      }
      db.prepare('DELETE FROM vec_recipes WHERE id = ?').run(id);
      db.prepare('INSERT INTO vec_recipes (id, embedding) VALUES (?, ?)').run(
        id,
        emb,
      );
    }
  });
  tx();
  return id;
}

/** @deprecated use insertRecipe — accepts legacy command_recipe shape */
export function insertCommand(clientOrCatalog, row) {
  const id =
    row.id != null
      ? String(row.id)
      : `legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const commands = parseCommands(row.command_recipe || row.commands);
  return insertRecipe(clientOrCatalog, {
    id,
    commands,
    title: row.title || primaryCommand(commands) || id,
    description: row.description || row.title || primaryCommand(commands) || id,
    tags: row.tags || [],
    taxonomy_leaf: row.taxonomy_leaf || 'unspecified',
    paraphrases: row.paraphrases || [],
    provenance: row.provenance || 'synthetic',
    validated: row.validated ?? true,
    initial_state: row.initial_state || '',
    command_fingerprint: row.command_fingerprint,
    initial_state_physical_hash: row.initial_state_physical_hash || '',
    final_state_physical_hash: row.final_state_physical_hash || '',
    risk: row.risk ?? 0,
  });
}

/** @deprecated intents removed in v9 */
export function insertIntentWithEmbedding() {
  throw new Error('intents removed in schema v9 — embed recipe.description via insertRecipe');
}

/** @deprecated */
export function insertCommandEmbedding() {
  throw new Error('vec_commands removed in schema v9');
}

export function countRecipes(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return Number(db.prepare('SELECT COUNT(*) AS n FROM recipes').get().n);
}

export function countCommands(clientOrCatalog) {
  return countRecipes(clientOrCatalog);
}

export function countIntents() {
  return 0;
}

export function getRecipe(clientOrCatalog, id) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return rowToRecipe(db.prepare('SELECT * FROM recipes WHERE id = ?').get(id));
}

export function getCommand(clientOrCatalog, rowId) {
  return getRecipe(clientOrCatalog, rowId);
}

export function listRecipes(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db
    .prepare('SELECT * FROM recipes ORDER BY id')
    .all()
    .map(rowToRecipe);
}

export function listCommands(clientOrCatalog) {
  return listRecipes(clientOrCatalog);
}

export function listRecipesByLeaf(clientOrCatalog, leafId) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db
    .prepare('SELECT * FROM recipes WHERE taxonomy_leaf = ? ORDER BY id')
    .all(leafId)
    .map(rowToRecipe);
}

export function findRecipeByFingerprint(clientOrCatalog, fingerprint) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return rowToRecipe(
    db
      .prepare('SELECT * FROM recipes WHERE command_fingerprint = ? LIMIT 1')
      .get(fingerprint),
  );
}

export function appendParaphrase(clientOrCatalog, recipeId, paraphrase) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const row = db.prepare('SELECT paraphrases FROM recipes WHERE id = ?').get(recipeId);
  if (!row) return false;
  const list = parseJsonArray(row.paraphrases);
  const text = String(paraphrase || '').trim();
  if (!text || list.includes(text)) return false;
  list.push(text);
  db.prepare('UPDATE recipes SET paraphrases = ? WHERE id = ?').run(
    JSON.stringify(list),
    recipeId,
  );
  return true;
}

/** Text embedded for KNN: description + paraphrases (not raw commands). */
export function recipeEmbedText(recipe) {
  const parts = [String(recipe?.description || '').trim()];
  for (const p of recipe?.paraphrases || []) {
    const t = String(p || '').trim();
    if (t) parts.push(t);
  }
  return parts.filter(Boolean).join('\n');
}

export function upsertRecipeEmbedding(clientOrCatalog, recipeId, embedding) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const id = String(recipeId);
  const emb =
    embedding instanceof Float32Array
      ? embedding
      : new Float32Array(embedding);
  if (emb.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim ${emb.length} !== ${EMBEDDING_DIM}`);
  }
  db.prepare('DELETE FROM vec_recipes WHERE id = ?').run(id);
  db.prepare('INSERT INTO vec_recipes (id, embedding) VALUES (?, ?)').run(id, emb);
}

export function hydrateRecipeHit(recipeRow, distance) {
  const commands = parseCommands(recipeRow.commands);
  const example = primaryCommand(commands) || commands[0]?.command || '';
  const title = String(recipeRow.title || '').trim() || example;
  const description = String(recipeRow.description || '');
  return {
    id: String(recipeRow.id),
    recipe_id: String(recipeRow.id),
    command_id: String(recipeRow.id),
    command: deriveCommandFamily(example),
    example,
    commands,
    snippet: renderSnippet(commands),
    title,
    description,
    usage: example,
    intent_family: '',
    simplicity_rank: commands.length,
    topic: recipeRow.taxonomy_leaf || '',
    taxonomy_leaf: recipeRow.taxonomy_leaf || '',
    tags: Array.isArray(recipeRow.tags)
      ? recipeRow.tags
      : parseJsonArray(recipeRow.tags),
    paraphrases: Array.isArray(recipeRow.paraphrases)
      ? recipeRow.paraphrases
      : parseJsonArray(recipeRow.paraphrases),
    skill_level: 4,
    skill_level_text: '',
    intent_category: '',
    intent_description: description,
    intent_text: description,
    explanation: description,
    risk: Number(recipeRow.risk ?? 0),
    initial_state: recipeRow.initial_state ?? '',
    provenance: recipeRow.provenance || 'synthetic',
    schema_version: SCHEMA_VERSION,
    embedding: null,
    _vecDistance: Number(distance),
    _forcedScore: distanceToSimilarity(distance),
  };
}

/** @deprecated */
export function hydrateSearchHit(intentRow, commandRow, distance) {
  return hydrateRecipeHit(
    {
      id: commandRow.row_id ?? commandRow.id,
      commands: commandRow.command_recipe || commandRow.commands,
      title: commandRow.title,
      description: intentRow?.intent_text || commandRow.description || '',
      taxonomy_leaf: commandRow.taxonomy_leaf,
      tags: commandRow.tags,
      paraphrases: commandRow.paraphrases,
      risk: commandRow.risk,
      initial_state: commandRow.initial_state,
      provenance: commandRow.provenance,
    },
    distance,
  );
}

export function rebuildRecipesFts(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  db.exec('DELETE FROM recipes_fts;');
  const rows = db
    .prepare(
      'SELECT id, commands, title, description, tags, paraphrases FROM recipes',
    )
    .all();
  const insert = db.prepare(
    'INSERT INTO recipes_fts (recipe_id, body) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      const steps = parseCommands(r.commands);
      insert.run(
        String(r.id),
        recipeFtsBody(steps, {
          title: r.title,
          description: r.description,
          tags: parseJsonArray(r.tags),
          paraphrases: parseJsonArray(r.paraphrases),
        }),
      );
    }
  });
  tx();
  return rows.length;
}

export function rebuildCommandsFts(clientOrCatalog) {
  return rebuildRecipesFts(clientOrCatalog);
}

export function countRecipesFts(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return Number(
    db.prepare('SELECT COUNT(*) AS n FROM recipes_fts').get()?.n ?? 0,
  );
}

export function countCommandsFts(clientOrCatalog) {
  return countRecipesFts(clientOrCatalog);
}

/**
 * Lexical BM25 recall over recipes_fts.
 * @returns {{ recipe_id: string, command_id: string, bm25: number }[]}
 */
export function ftsRecall(clientOrCatalog, query, k = DEFAULT_RECALL_K) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const match = buildFtsMatchQuery(query);
  if (!match) return [];
  const want = Math.max(1, Math.floor(k));
  try {
    const rows = db
      .prepare(
        `
      SELECT recipe_id AS recipe_id, bm25(recipes_fts) AS bm25
      FROM recipes_fts
      WHERE recipes_fts MATCH ?
      ORDER BY bm25
      LIMIT ?
      `,
      )
      .all(match, want);
    return rows.map((r) => ({
      recipe_id: String(r.recipe_id),
      command_id: String(r.recipe_id),
      bm25: Number(r.bm25),
    }));
  } catch {
    return [];
  }
}

export function knnRecall(clientOrCatalog, queryEmbedding, k = DEFAULT_RECALL_K, opts = {}) {
  void opts;
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const embedding =
    queryEmbedding instanceof Float32Array
      ? queryEmbedding
      : new Float32Array(queryEmbedding);
  const want = Math.max(1, Math.floor(k));

  const hits = db
    .prepare(
      `
      SELECT id, distance
      FROM vec_recipes
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
      `,
    )
    .all(embedding, want);

  if (hits.length === 0) return [];

  const ids = hits.map((h) => h.id);
  const placeholders = ids.map(() => '?').join(',');
  const metaRows = db
    .prepare(`SELECT * FROM recipes WHERE id IN (${placeholders})`)
    .all(...ids);
  const byId = new Map(metaRows.map((r) => [String(r.id), r]));

  return hits
    .map((h) => {
      const meta = byId.get(String(h.id));
      if (!meta) return null;
      return hydrateRecipeHit(rowToRecipe(meta), h.distance);
    })
    .filter(Boolean);
}

export function knnRecallRecipes(clientOrCatalog, queryEmbedding, k = DEFAULT_RECALL_K) {
  return knnRecall(clientOrCatalog, queryEmbedding, k);
}

/** @deprecated */
export function knnRecallCommands() {
  return [];
}

export function loadAllRows(clientOrCatalog) {
  return listRecipes(clientOrCatalog).map((r) =>
    hydrateRecipeHit(r, 0),
  );
}

export function promoteStagingDb(stagingPath, prodPath) {
  mkdirSync(path.dirname(prodPath), { recursive: true });
  if (existsSync(prodPath)) unlinkSync(prodPath);
  copyFileSync(stagingPath, prodPath);
  const db = openDb(prodPath);
  try {
    finalizeSearchIndex(db);
  } finally {
    db.close();
  }
  return prodPath;
}

/** no-op — vec_commands removed */
export function stripVecCommandsForShip() {}

export function finalizeSearchIndex(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  rebuildRecipesFts(db);
  const rows = db.prepare('SELECT commands FROM recipes').all();
  const recipes = rows.map((r) => {
    try {
      return JSON.parse(r.commands);
    } catch {
      return { commands: [] };
    }
  });
  const verbs = collectGitVerbsFromRecipes(recipes);
  const setMeta = db.prepare(
    'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
  );
  setMeta.run('git_verbs', serializeGitVerbsMeta(verbs));
  setMeta.run('search_algorithm_version', String(SEARCH_ALGORITHM_VERSION));
  setMeta.run('schema_version', String(SCHEMA_VERSION));
  return { verbs, searchAlgorithmVersion: SEARCH_ALGORITHM_VERSION };
}

export function getMetaValue(clientOrCatalog, key) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

export function setMetaValue(clientOrCatalog, key, value) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    String(key),
    value == null ? '' : String(value),
  );
}

export function loadGitVerbs(clientOrCatalog) {
  return parseGitVerbsMeta(getMetaValue(clientOrCatalog, 'git_verbs'));
}

export function dbExists(dbPath) {
  return existsSync(dbPath);
}

export function smokeTestSqliteVec() {
  try {
    const db = new Database(':memory:');
    const version = loadSqliteVec(db);
    db.close();
    return { ok: true, version };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e) };
  }
}
