import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import { SCHEMA_VERSION, EMBEDDING_DIM, DEFAULT_RECALL_K } from './constants.js';
import { normalizeUsage, cosineSimilarity, distanceToSimilarity } from './utils.js';
import {
  serializeCommands,
  parseCommands,
  renderSnippet,
} from './recipeFormat.js';

export { SCHEMA_VERSION, EMBEDDING_DIM, DEFAULT_RECALL_K };
export { normalizeUsage, cosineSimilarity, distanceToSimilarity };
export { serializeCommands, parseCommands, renderSnippet };

export const DDL = `
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  commands TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  intent_family TEXT NOT NULL DEFAULT '',
  simplicity_rank INTEGER NOT NULL DEFAULT 1,
  usage TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  primary_example TEXT NOT NULL,
  command TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION}
);
CREATE INDEX IF NOT EXISTS idx_recipes_command ON recipes(command);
CREATE INDEX IF NOT EXISTS idx_recipes_family ON recipes(intent_family);
CREATE INDEX IF NOT EXISTS idx_recipes_example ON recipes(primary_example);

CREATE TABLE IF NOT EXISTS search_intents (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id),
  intent_text TEXT NOT NULL,
  skill_level INTEGER NOT NULL CHECK (skill_level BETWEEN 1 AND 4)
);
CREATE INDEX IF NOT EXISTS idx_search_intents_recipe ON search_intents(recipe_id);
CREATE INDEX IF NOT EXISTS idx_search_intents_skill ON search_intents(skill_level);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_intents USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[${EMBEDDING_DIM}] distance_metric=cosine
);
`;

function maybeSetCustomSqlite() {
  if (process.platform !== 'darwin') return;
  const candidates = [
    process.env.GIT_HELP_SQLITE_LIB,
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

/**
 * Load sqlite-vec into a Bun Database. Throws if the extension cannot load.
 * @param {import('bun:sqlite').Database} db
 */
export function loadSqliteVec(db) {
  maybeSetCustomSqlite();
  sqliteVec.load(db);
  const row = db.prepare('SELECT vec_version() AS v').get();
  if (!row?.v) {
    throw new Error('sqlite-vec loaded but vec_version() returned empty');
  }
  return String(row.v);
}

/**
 * Open (or create) the catalog database with schema v5 + sqlite-vec.
 * @param {string} dbPath
 * @param {{ readonly?: boolean }} [opts]
 * @returns {import('bun:sqlite').Database}
 */
export function openDb(dbPath, { readonly = false } = {}) {
  if (dbPath !== ':memory:' && !readonly) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath, readonly ? { readonly: true } : undefined);
  if (!readonly) {
    // Catalog is write-once (seed) then read-mostly. WAL changes the file after
    // checksum and breaks integrity verification for end users.
    db.exec('PRAGMA journal_mode = DELETE;');
  }
  loadSqliteVec(db);
  if (!readonly) {
    ensureSchemaV5(db);
  }
  return db;
}

/**
 * Opaque catalog handle for public API consumers.
 * @param {string} dbPath
 */
export function openCatalog(dbPath) {
  const db = openDb(dbPath);
  return {
    path: dbPath,
    schemaVersion: SCHEMA_VERSION,
    /** @internal */
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

function dropLegacyAndV5(db) {
  db.exec('DROP TABLE IF EXISTS vec_intents;');
  db.exec('DROP TABLE IF EXISTS search_intents;');
  db.exec('DROP TABLE IF EXISTS recipes;');
  db.exec('DROP TABLE IF EXISTS vec_commands;');
  db.exec('DROP TABLE IF EXISTS git_commands;');
}

function ensureSchemaV5(db) {
  const tables = tableNames(db);
  const hasRecipes = tables.includes('recipes');
  const hasIntents = tables.includes('search_intents');
  const hasVec = tables.includes('vec_intents');
  const hasLegacy = tables.includes('git_commands') || tables.includes('vec_commands');

  if (hasLegacy || (hasRecipes && (!hasIntents || !hasVec))) {
    dropLegacyAndV5(db);
    db.exec(DDL);
    return;
  }

  if (hasRecipes) {
    const cols = new Set(
      db.prepare('PRAGMA table_info(recipes)').all().map((r) => r.name),
    );
    const required = [
      'title', 'commands', 'explanation', 'intent_family', 'simplicity_rank',
      'usage', 'topic', 'primary_example', 'command', 'schema_version',
    ];
    const missing = required.filter((c) => !cols.has(c));
    const versionRow = db
      .prepare('SELECT schema_version AS v FROM recipes LIMIT 1')
      .get();
    const versionOk = versionRow == null || Number(versionRow.v) === SCHEMA_VERSION;
    if (missing.length || !hasIntents || !hasVec || !versionOk) {
      dropLegacyAndV5(db);
      db.exec(DDL);
    }
    return;
  }

  db.exec(DDL);
}

/**
 * @param {import('bun:sqlite').Database | { _db: import('bun:sqlite').Database }} clientOrCatalog
 * @param {object} recipe
 */
export function insertRecipe(clientOrCatalog, recipe) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const primary = recipe.primary_example
    || parseCommands(recipe.commands)[0]?.run
    || recipe.command
    || '';
  const usage = normalizeUsage(recipe.usage, primary);
  const commandsJson = serializeCommands(recipe.commands);

  db.prepare(`
    INSERT OR REPLACE INTO recipes
      (id, title, commands, explanation, intent_family, simplicity_rank,
       usage, topic, primary_example, command, schema_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recipe.id,
    recipe.title || primary,
    commandsJson,
    recipe.explanation ?? '',
    recipe.intent_family ?? '',
    recipe.simplicity_rank ?? 1,
    usage,
    recipe.topic ?? '',
    primary,
    recipe.command || deriveCommandFamily(primary),
    SCHEMA_VERSION,
  );
}

function deriveCommandFamily(example) {
  const parts = String(example || '').trim().split(/\s+/);
  if (parts[0] === 'git' && parts[1] && !parts[1].startsWith('-')) {
    return `git ${parts[1]}`;
  }
  return parts[0] === 'git' ? 'git' : String(example || '').trim();
}

/**
 * @param {import('bun:sqlite').Database | { _db: import('bun:sqlite').Database }} clientOrCatalog
 * @param {object} intent
 */
export function insertIntentWithEmbedding(clientOrCatalog, intent) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const embedding = intent.embedding instanceof Float32Array
    ? intent.embedding
    : new Float32Array(intent.embedding);

  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim ${embedding.length} !== ${EMBEDDING_DIM}`);
  }

  const insertMeta = db.prepare(`
    INSERT OR REPLACE INTO search_intents
      (id, recipe_id, intent_text, skill_level)
    VALUES (?, ?, ?, ?)
  `);
  const deleteVec = db.prepare('DELETE FROM vec_intents WHERE id = ?');
  const insertVec = db.prepare(
    'INSERT INTO vec_intents (id, embedding) VALUES (?, ?)',
  );

  const tx = db.transaction(() => {
    insertMeta.run(
      intent.id,
      intent.recipe_id,
      intent.intent_text || intent.intent_description,
      intent.skill_level,
    );
    deleteVec.run(intent.id);
    insertVec.run(intent.id, embedding);
  });
  tx();
}

/**
 * @deprecated Prefer insertRecipe + insertIntentWithEmbedding.
 * Accepts a denormalized v4-style row and writes recipe + intent.
 */
export function insertCommandRow(clientOrCatalog, row) {
  const commands = row.commands
    || [{ run: row.example || row.command, comment: '' }];
  const recipeId = row.recipe_id || row.id?.split(':')[0] || commandSlugFallback(row.example || row.command);
  insertRecipe(clientOrCatalog, {
    id: recipeId,
    title: row.title || row.example || row.command,
    commands,
    explanation: row.explanation,
    intent_family: row.intent_family,
    simplicity_rank: row.simplicity_rank,
    usage: row.usage,
    topic: row.topic,
    primary_example: row.example || row.primary_example,
    command: row.command,
  });
  insertIntentWithEmbedding(clientOrCatalog, {
    id: row.id,
    recipe_id: recipeId,
    intent_text: row.intent_description || row.intent_text,
    skill_level: row.skill_level,
    embedding: row.embedding,
  });
}

function commandSlugFallback(text) {
  return String(text || 'recipe')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'recipe';
}

/**
 * Flatten joined intent+recipe into a search/CLI/eval hit.
 * @param {object} intentRow
 * @param {object} recipeRow
 * @param {number} distance
 */
export function hydrateSearchHit(intentRow, recipeRow, distance) {
  const commands = parseCommands(recipeRow.commands);
  return {
    id: intentRow.id,
    recipe_id: recipeRow.id,
    command: recipeRow.command,
    example: recipeRow.primary_example,
    commands,
    snippet: renderSnippet(commands),
    title: recipeRow.title,
    usage: recipeRow.usage ?? recipeRow.primary_example,
    intent_family: recipeRow.intent_family ?? '',
    simplicity_rank: Number(recipeRow.simplicity_rank ?? 1),
    topic: recipeRow.topic ?? '',
    skill_level: Number(intentRow.skill_level),
    intent_description: intentRow.intent_text,
    intent_text: intentRow.intent_text,
    explanation: recipeRow.explanation,
    schema_version: Number(recipeRow.schema_version),
    embedding: null,
    _vecDistance: Number(distance),
    _forcedScore: distanceToSimilarity(distance),
  };
}

/**
 * KNN recall via sqlite-vec, then hydrate recipe + intent metadata.
 * When maxSkillLevel is set, over-fetches from vec0 and hydrates with
 * `skill_level <= maxSkillLevel` so JS re-rank still sees enough candidates.
 *
 * @param {import('bun:sqlite').Database | { _db: import('bun:sqlite').Database }} clientOrCatalog
 * @param {Float32Array|number[]} queryEmbedding
 * @param {number} k
 * @param {{ maxSkillLevel?: number | null }} [opts]
 */
export function knnRecall(clientOrCatalog, queryEmbedding, k = DEFAULT_RECALL_K, opts = {}) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const embedding = queryEmbedding instanceof Float32Array
    ? queryEmbedding
    : new Float32Array(queryEmbedding);
  const want = Math.max(1, Math.floor(k));
  const maxSkill = opts.maxSkillLevel == null ? null : Number(opts.maxSkillLevel);
  const fetchK = maxSkill != null ? Math.min(Math.max(want * 4, want), 400) : want;

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
  const skillClause = maxSkill != null ? 'AND i.skill_level <= ?' : '';
  const params = maxSkill != null ? [...ids, maxSkill] : ids;
  const metaRows = db
    .prepare(
      `
      SELECT
        i.id AS intent_id,
        i.recipe_id AS recipe_id,
        i.intent_text AS intent_text,
        i.skill_level AS skill_level,
        r.id AS r_id,
        r.title AS title,
        r.commands AS commands,
        r.explanation AS explanation,
        r.intent_family AS intent_family,
        r.simplicity_rank AS simplicity_rank,
        r.usage AS usage,
        r.topic AS topic,
        r.primary_example AS primary_example,
        r.command AS command,
        r.schema_version AS schema_version
      FROM search_intents i
      JOIN recipes r ON r.id = i.recipe_id
      WHERE i.id IN (${placeholders})
      ${skillClause}
      `,
    )
    .all(...params);

  const byId = new Map(metaRows.map((r) => [r.intent_id, r]));
  return hits
    .map((h) => {
      const meta = byId.get(h.id);
      if (!meta) return null;
      return hydrateSearchHit(
        {
          id: meta.intent_id,
          intent_text: meta.intent_text,
          skill_level: meta.skill_level,
        },
        {
          id: meta.r_id,
          title: meta.title,
          commands: meta.commands,
          explanation: meta.explanation,
          intent_family: meta.intent_family,
          simplicity_rank: meta.simplicity_rank,
          usage: meta.usage,
          topic: meta.topic,
          primary_example: meta.primary_example,
          command: meta.command,
          schema_version: meta.schema_version,
        },
        h.distance,
      );
    })
    .filter(Boolean);
}

/** Debug / tests / web-pack: denormalized intent rows joined to recipes. */
export function loadAllRows(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db
    .prepare(
      `
      SELECT
        i.id AS intent_id,
        i.recipe_id AS recipe_id,
        i.intent_text AS intent_text,
        i.skill_level AS skill_level,
        r.title AS title,
        r.commands AS commands,
        r.explanation AS explanation,
        r.intent_family AS intent_family,
        r.simplicity_rank AS simplicity_rank,
        r.usage AS usage,
        r.topic AS topic,
        r.primary_example AS primary_example,
        r.command AS command,
        r.schema_version AS schema_version
      FROM search_intents i
      JOIN recipes r ON r.id = i.recipe_id
      `,
    )
    .all()
    .map((r) => {
      const commands = parseCommands(r.commands);
      return {
        id: r.intent_id,
        recipe_id: r.recipe_id,
        title: r.title,
        command: r.command,
        example: r.primary_example,
        primary_example: r.primary_example,
        commands,
        snippet: renderSnippet(commands),
        usage: r.usage ?? r.primary_example,
        intent_family: r.intent_family ?? '',
        simplicity_rank: Number(r.simplicity_rank ?? 1),
        topic: r.topic ?? '',
        skill_level: Number(r.skill_level),
        intent_description: r.intent_text,
        intent_text: r.intent_text,
        explanation: r.explanation,
        schema_version: Number(r.schema_version),
        embedding: null,
      };
    });
}

export function dbExists(dbPath) {
  return existsSync(dbPath);
}

/**
 * Smoke-test sqlite-vec on an in-memory DB. Used by postinstall/doctor.
 * @returns {{ ok: boolean, version?: string, reason?: string }}
 */
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
