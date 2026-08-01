// @ts-nocheck
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
import { SKILL_RANK, normalizeSkillLevelText } from '../lib/skills.js';
import { buildFtsMatchQuery, commandFtsBody } from '../search/ftsQuery.js';
import {
  collectGitVerbsFromRecipes,
  serializeGitVerbsMeta,
  parseGitVerbsMeta,
} from '../search/gitVerbs.js';

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
CREATE TABLE IF NOT EXISTS commands (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  initial_state TEXT NOT NULL,
  command_recipe TEXT NOT NULL,
  initial_state_physical_hash TEXT NOT NULL,
  final_state_physical_hash TEXT NOT NULL,
  risk REAL NOT NULL CHECK (risk >= 0 AND risk <= 1),
  parent_row_id INTEGER REFERENCES commands(row_id),
  mutation_kind TEXT CHECK (mutation_kind IS NULL OR mutation_kind IN ('state','flag','composition'))
);
CREATE INDEX IF NOT EXISTS idx_commands_initial_hash ON commands(initial_state_physical_hash);
CREATE INDEX IF NOT EXISTS idx_commands_final_hash ON commands(final_state_physical_hash);
CREATE INDEX IF NOT EXISTS idx_commands_hash_pair ON commands(initial_state_physical_hash, final_state_physical_hash);
CREATE INDEX IF NOT EXISTS idx_commands_parent ON commands(parent_row_id);

CREATE TABLE IF NOT EXISTS intents (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  command_id INTEGER NOT NULL REFERENCES commands(row_id),
  skill_level TEXT NOT NULL CHECK (skill_level IN ('nontechnical','beginner','intermediate','expert')),
  intent_category TEXT NOT NULL CHECK (intent_category IN ('goal','error_message','symptom','conversational')),
  intent_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_command ON intents(command_id);
CREATE INDEX IF NOT EXISTS idx_intents_skill ON intents(skill_level);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_intents USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_commands USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}] distance_metric=cosine
);

CREATE VIRTUAL TABLE IF NOT EXISTS commands_fts USING fts5(
  command_id UNINDEXED,
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
    ensureSchemaV6(db);
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
    'commands_fts',
    'vec_intents',
    'vec_commands',
    'intents',
    'commands',
    'search_intents',
    'recipes',
    'git_commands',
    'meta',
  ]) {
    db.exec(`DROP TABLE IF EXISTS ${t};`);
  }
}

function ensureSchemaV6(db) {
  const tables = tableNames(db);
  const hasCommands = tables.includes('commands');
  const hasIntents = tables.includes('intents');
  const hasVecI = tables.includes('vec_intents');
  const hasVecC = tables.includes('vec_commands');
  const hasFts = tables.includes('commands_fts');
  const hasLegacy =
    tables.includes('recipes') ||
    tables.includes('search_intents') ||
    tables.includes('git_commands');

  // vec_commands is optional on shipped product DBs (dropped at promote).
  if (hasLegacy || !hasCommands || !hasIntents || !hasVecI) {
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

  if (!hasFts) {
    db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS commands_fts USING fts5(
  command_id UNINDEXED,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`);
  }

  // Recreate vec_commands only when absent AND caller needs build-loop support.
  // Product DBs omit it intentionally; create empty shell if other vec table exists
  // and we're in a write path that already had commands (no-op for shipped after promote).
  if (!hasVecC && process.env.GIT_GRASP_ENSURE_VEC_COMMANDS === '1') {
    db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS vec_commands USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}] distance_metric=cosine
);
`);
  }
}

function deriveCommandFamily(example) {
  const parts = String(example || '').trim().split(/\s+/);
  if (parts[0] === 'git' && parts[1] && !parts[1].startsWith('-')) {
    return `git ${parts[1]}`;
  }
  return parts[0] === 'git' ? 'git' : String(example || '').trim();
}

/**
 * Insert a commands row. Returns row_id.
 */
export function insertCommand(clientOrCatalog, row) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const recipeJson = serializeCommandRecipe(row.command_recipe);
  const result = db
    .prepare(
      `
    INSERT INTO commands
      (initial_state, command_recipe, initial_state_physical_hash,
       final_state_physical_hash, risk, parent_row_id, mutation_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      row.initial_state,
      recipeJson,
      row.initial_state_physical_hash,
      row.final_state_physical_hash,
      row.risk,
      row.parent_row_id ?? null,
      row.mutation_kind ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function insertIntentWithEmbedding(clientOrCatalog, intent) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const embedding =
    intent.embedding instanceof Float32Array
      ? intent.embedding
      : new Float32Array(intent.embedding);

  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim ${embedding.length} !== ${EMBEDDING_DIM}`);
  }

  const skill = normalizeSkillLevelText(intent.skill_level) || intent.skill_level;

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
      INSERT INTO intents (command_id, skill_level, intent_category, intent_text)
      VALUES (?, ?, ?, ?)
    `,
      )
      .run(
        intent.command_id,
        skill,
        intent.intent_category,
        intent.intent_text || intent.intent_description,
      );
    const rowId = Number(result.lastInsertRowid);
    const id = String(rowId);
    db.prepare('DELETE FROM vec_intents WHERE id = ?').run(id);
    db.prepare('INSERT INTO vec_intents (id, embedding) VALUES (?, ?)').run(
      id,
      embedding,
    );
    return rowId;
  });
  return tx();
}

export function insertCommandEmbedding(clientOrCatalog, commandId, embedding) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const vec =
    embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  if (vec.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim ${vec.length} !== ${EMBEDDING_DIM}`);
  }
  const id = String(commandId);
  db.prepare('DELETE FROM vec_commands WHERE id = ?').run(id);
  db.prepare('INSERT INTO vec_commands (id, embedding) VALUES (?, ?)').run(id, vec);
}

export function findCommandByHashPair(clientOrCatalog, initialHash, finalHash) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db
    .prepare(
      `
    SELECT * FROM commands
    WHERE initial_state_physical_hash = ? AND final_state_physical_hash = ?
    LIMIT 1
  `,
    )
    .get(initialHash, finalHash);
}

export function deleteCommandCascade(clientOrCatalog, rowId) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const tx = db.transaction(() => {
    const intents = db
      .prepare('SELECT row_id FROM intents WHERE command_id = ?')
      .all(rowId);
    for (const i of intents) {
      db.prepare('DELETE FROM vec_intents WHERE id = ?').run(String(i.row_id));
    }
    db.prepare('DELETE FROM intents WHERE command_id = ?').run(rowId);
    db.prepare('DELETE FROM vec_commands WHERE id = ?').run(String(rowId));
    db.prepare('DELETE FROM commands WHERE row_id = ?').run(rowId);
  });
  tx();
}

export function countCommands(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return Number(db.prepare('SELECT COUNT(*) AS n FROM commands').get().n);
}

export function countIntents(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return Number(db.prepare('SELECT COUNT(*) AS n FROM intents').get().n);
}

export function hydrateSearchHit(intentRow, commandRow, distance) {
  const commands = parseCommands(commandRow.command_recipe || commandRow.commands);
  const example = primaryCommand(commands) || commands[0]?.command || '';
  const skillText =
    typeof intentRow.skill_level === 'string'
      ? normalizeSkillLevelText(intentRow.skill_level) || intentRow.skill_level
      : intentRow.skill_level;
  const skillRank =
    typeof skillText === 'string' ? SKILL_RANK[skillText] ?? 4 : Number(skillText);
  return {
    id: String(intentRow.row_id ?? intentRow.id),
    recipe_id: String(commandRow.row_id ?? commandRow.id),
    command_id: Number(commandRow.row_id ?? commandRow.id),
    command: deriveCommandFamily(example),
    example,
    commands,
    snippet: renderSnippet(commands),
    title: example,
    usage: example,
    intent_family: '',
    simplicity_rank: commands.length,
    topic: '',
    skill_level: skillRank,
    skill_level_text: skillText,
    intent_category: intentRow.intent_category ?? '',
    intent_description: intentRow.intent_text,
    intent_text: intentRow.intent_text,
    explanation: '',
    risk: Number(commandRow.risk ?? 0),
    initial_state: commandRow.initial_state ?? '',
    schema_version: SCHEMA_VERSION,
    embedding: null,
    _vecDistance: Number(distance),
    _forcedScore: distanceToSimilarity(distance),
  };
}

/** Rebuild commands_fts from all commands rows (+ intent_text for NL recall). */
export function rebuildCommandsFts(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  db.exec('DELETE FROM commands_fts;');
  const rows = db.prepare('SELECT row_id, command_recipe FROM commands').all();
  const intentStmt = db.prepare(
    'SELECT intent_text FROM intents WHERE command_id = ? ORDER BY row_id LIMIT 24',
  );
  const insert = db.prepare(
    'INSERT INTO commands_fts (command_id, body) VALUES (?, ?)',
  );
  const tx = db.transaction(() => {
    for (const r of rows) {
      const steps = parseCommands(r.command_recipe);
      const intents = intentStmt.all(r.row_id).map((i) => i.intent_text);
      insert.run(String(r.row_id), commandFtsBody(steps, intents));
    }
  });
  tx();
  return rows.length;
}

export function countCommandsFts(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return Number(
    db.prepare('SELECT COUNT(*) AS n FROM commands_fts').get()?.n ?? 0,
  );
}

/**
 * Lexical BM25 recall over commands_fts.
 * @returns {{ command_id: number, bm25: number }[]}
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
      SELECT command_id AS command_id, bm25(commands_fts) AS bm25
      FROM commands_fts
      WHERE commands_fts MATCH ?
      ORDER BY bm25
      LIMIT ?
      `,
      )
      .all(match, want);
    return rows.map((r) => ({
      command_id: Number(r.command_id),
      bm25: Number(r.bm25),
    }));
  } catch {
    return [];
  }
}

export function knnRecall(clientOrCatalog, queryEmbedding, k = DEFAULT_RECALL_K, opts = {}) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const embedding =
    queryEmbedding instanceof Float32Array
      ? queryEmbedding
      : new Float32Array(queryEmbedding);
  const want = Math.max(1, Math.floor(k));
  // Skill filter removed from product search (blend-only). opts.maxSkillLevel ignored.
  void opts;
  const fetchK = want;

  const hits = db
    .prepare(
      `
      SELECT id, distance
      FROM vec_intents
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
      `,
    )
    .all(embedding, fetchK);

  if (hits.length === 0) return [];

  const ids = hits.map((h) => h.id);
  const placeholders = ids.map(() => '?').join(',');
  const params = [...ids];

  const metaRows = db
    .prepare(
      `
      SELECT
        i.row_id AS intent_id,
        i.command_id AS command_id,
        i.intent_text AS intent_text,
        i.skill_level AS skill_level,
        i.intent_category AS intent_category,
        c.row_id AS c_id,
        c.initial_state AS initial_state,
        c.command_recipe AS command_recipe,
        c.risk AS risk
      FROM intents i
      JOIN commands c ON c.row_id = i.command_id
      WHERE CAST(i.row_id AS TEXT) IN (${placeholders})
      `,
    )
    .all(...params);

  const byId = new Map(metaRows.map((r) => [String(r.intent_id), r]));
  return hits
    .map((h) => {
      const meta = byId.get(String(h.id));
      if (!meta) return null;
      return hydrateSearchHit(
        {
          row_id: meta.intent_id,
          intent_text: meta.intent_text,
          skill_level: meta.skill_level,
          intent_category: meta.intent_category,
        },
        {
          row_id: meta.c_id,
          initial_state: meta.initial_state,
          command_recipe: meta.command_recipe,
          risk: meta.risk,
        },
        h.distance,
      );
    })
    .filter(Boolean);
}

export function knnRecallCommands(clientOrCatalog, queryEmbedding, k = 10) {
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
      FROM vec_commands
      WHERE embedding MATCH ?
        AND k = ?
      ORDER BY distance
      `,
    )
    .all(embedding, want);
  return hits.map((h) => ({
    command_id: Number(h.id),
    distance: Number(h.distance),
  }));
}

export function loadAllRows(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db
    .prepare(
      `
      SELECT
        i.row_id AS intent_id,
        i.command_id AS command_id,
        i.intent_text AS intent_text,
        i.skill_level AS skill_level,
        i.intent_category AS intent_category,
        c.initial_state AS initial_state,
        c.command_recipe AS command_recipe,
        c.risk AS risk
      FROM intents i
      JOIN commands c ON c.row_id = i.command_id
      `,
    )
    .all()
    .map((r) => {
      const commands = parseCommands(r.command_recipe);
      const example = primaryCommand(commands);
      return {
        id: String(r.intent_id),
        recipe_id: String(r.command_id),
        command_id: Number(r.command_id),
        title: example,
        command: deriveCommandFamily(example),
        example,
        primary_example: example,
        commands,
        snippet: renderSnippet(commands),
        usage: example,
        intent_family: '',
        simplicity_rank: commands.length,
        topic: '',
        skill_level: SKILL_RANK[r.skill_level] ?? 4,
        skill_level_text: r.skill_level,
        intent_category: r.intent_category,
        intent_description: r.intent_text,
        intent_text: r.intent_text,
        explanation: '',
        risk: Number(r.risk),
        schema_version: SCHEMA_VERSION,
        embedding: null,
      };
    });
}

export function getCommand(clientOrCatalog, rowId) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db.prepare('SELECT * FROM commands WHERE row_id = ?').get(rowId);
}

export function listCommands(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db.prepare('SELECT * FROM commands ORDER BY row_id').all();
}

export function promoteStagingDb(stagingPath, prodPath) {
  mkdirSync(path.dirname(prodPath), { recursive: true });
  if (existsSync(prodPath)) unlinkSync(prodPath);
  copyFileSync(stagingPath, prodPath);
  const db = openDb(prodPath);
  try {
    finalizeSearchIndex(db);
    stripVecCommandsForShip(db);
  } finally {
    db.close();
  }
  return prodPath;
}

/** Drop vec_commands from a product/shipped DB (build loop keeps it on staging). */
export function stripVecCommandsForShip(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  db.exec('DROP TABLE IF EXISTS vec_commands;');
}

/**
 * Rebuild FTS, write git_verbs + search_algorithm_version meta.
 */
export function finalizeSearchIndex(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  rebuildCommandsFts(db);
  const rows = db.prepare('SELECT command_recipe FROM commands').all();
  const recipes = rows.map((r) => {
    try {
      return JSON.parse(r.command_recipe);
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

/** Persist a meta key on an open DB / catalog handle. */
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

/** @deprecated use insertCommand */
export function insertRecipe(clientOrCatalog, recipe) {
  return insertCommand(clientOrCatalog, {
    initial_state: recipe.initial_state || 'git init\n',
    command_recipe: recipe.command_recipe || {
      commands: parseCommands(recipe.commands).map((s) => ({
        command: s.command,
        comment: s.comment,
      })),
    },
    initial_state_physical_hash: recipe.initial_state_physical_hash || 'legacy',
    final_state_physical_hash: recipe.final_state_physical_hash || 'legacy',
    risk: recipe.risk ?? 0,
    parent_row_id: recipe.parent_row_id ?? null,
  });
}
