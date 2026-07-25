import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import * as sqliteVec from 'sqlite-vec';
import { SCHEMA_VERSION, EMBEDDING_DIM, DEFAULT_RECALL_K } from './constants.js';
import { normalizeUsage, cosineSimilarity, distanceToSimilarity } from './utils.js';

export { SCHEMA_VERSION, EMBEDDING_DIM, DEFAULT_RECALL_K };
export { normalizeUsage, cosineSimilarity, distanceToSimilarity };

export const DDL = `
CREATE TABLE IF NOT EXISTS git_commands (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  example TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT '',
  intent_family TEXT NOT NULL DEFAULT '',
  simplicity_rank INTEGER NOT NULL DEFAULT 1,
  skill_level INTEGER NOT NULL CHECK (skill_level BETWEEN 1 AND 4),
  intent_description TEXT NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT ${SCHEMA_VERSION}
);
CREATE INDEX IF NOT EXISTS idx_git_commands_skill ON git_commands(skill_level);
CREATE INDEX IF NOT EXISTS idx_git_commands_command ON git_commands(command);
CREATE INDEX IF NOT EXISTS idx_git_commands_example ON git_commands(example);
CREATE INDEX IF NOT EXISTS idx_git_commands_family ON git_commands(intent_family);
CREATE VIRTUAL TABLE IF NOT EXISTS vec_commands USING vec0(
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
 * Open (or create) the catalog database with schema v4 + sqlite-vec.
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
    ensureSchemaV4(db);
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

function ensureSchemaV4(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
    .all()
    .map((r) => r.name);
  const hasMeta = tables.includes('git_commands');
  const hasVec = tables.includes('vec_commands');

  if (hasMeta) {
    const cols = new Set(
      db.prepare('PRAGMA table_info(git_commands)').all().map((r) => r.name),
    );
    const required = ['example', 'intent_family', 'simplicity_rank', 'usage'];
    const missing = required.filter((c) => !cols.has(c));
    const hasLegacyRisk = cols.has('risk_class') || cols.has('risks');
    const hasLegacyEmbedding = cols.has('embedding');
    const versionRow = db
      .prepare('SELECT schema_version AS v FROM git_commands LIMIT 1')
      .get();
    const versionOk = versionRow == null || Number(versionRow.v) === SCHEMA_VERSION;

    if (missing.length || hasLegacyRisk || hasLegacyEmbedding || !hasVec || !versionOk) {
      db.exec('DROP TABLE IF EXISTS vec_commands;');
      db.exec('DROP TABLE IF EXISTS git_commands;');
    } else {
      return;
    }
  } else if (hasVec) {
    db.exec('DROP TABLE IF EXISTS vec_commands;');
  }

  db.exec(DDL);
}

/**
 * @param {import('bun:sqlite').Database | { _db: import('bun:sqlite').Database }} clientOrCatalog
 * @param {object} row
 */
export function insertCommandRow(clientOrCatalog, row) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const example = row.example ?? row.command;
  const usage = normalizeUsage(row.usage, example);
  const embedding = row.embedding instanceof Float32Array
    ? row.embedding
    : new Float32Array(row.embedding);

  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(`embedding dim ${embedding.length} !== ${EMBEDDING_DIM}`);
  }

  const insertMeta = db.prepare(`
    INSERT OR REPLACE INTO git_commands
      (id, command, example, usage, intent_family, simplicity_rank, skill_level,
       intent_description, explanation, schema_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const deleteVec = db.prepare('DELETE FROM vec_commands WHERE id = ?');
  const insertVec = db.prepare(
    'INSERT INTO vec_commands (id, embedding) VALUES (?, ?)',
  );

  const tx = db.transaction(() => {
    insertMeta.run(
      row.id,
      row.command,
      example,
      usage,
      row.intent_family ?? '',
      row.simplicity_rank ?? 1,
      row.skill_level,
      row.intent_description,
      row.explanation ?? '',
      SCHEMA_VERSION,
    );
    deleteVec.run(row.id);
    insertVec.run(row.id, embedding);
  });
  tx();
}

/**
 * KNN recall via sqlite-vec, then hydrate metadata.
 * @param {import('bun:sqlite').Database | { _db: import('bun:sqlite').Database }} clientOrCatalog
 * @param {Float32Array|number[]} queryEmbedding
 * @param {number} k
 */
export function knnRecall(clientOrCatalog, queryEmbedding, k = DEFAULT_RECALL_K) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  const embedding = queryEmbedding instanceof Float32Array
    ? queryEmbedding
    : new Float32Array(queryEmbedding);
  const limit = Math.max(1, Math.floor(k));

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
    .all(embedding, limit);

  if (hits.length === 0) return [];

  const ids = hits.map((h) => h.id);
  const placeholders = ids.map(() => '?').join(',');
  const metaRows = db
    .prepare(
      `
      SELECT id, command, example, usage, intent_family, simplicity_rank,
             skill_level, intent_description, explanation, schema_version
      FROM git_commands
      WHERE id IN (${placeholders})
      `,
    )
    .all(...ids);

  const byId = new Map(metaRows.map((r) => [r.id, r]));
  return hits
    .map((h) => {
      const meta = byId.get(h.id);
      if (!meta) return null;
      return {
        id: meta.id,
        command: meta.command,
        example: meta.example ?? meta.command,
        usage: meta.usage ?? meta.example ?? meta.command,
        intent_family: meta.intent_family ?? '',
        simplicity_rank: Number(meta.simplicity_rank ?? 1),
        skill_level: Number(meta.skill_level),
        intent_description: meta.intent_description,
        explanation: meta.explanation,
        schema_version: Number(meta.schema_version),
        embedding: null,
        _vecDistance: Number(h.distance),
        _forcedScore: distanceToSimilarity(h.distance),
      };
    })
    .filter(Boolean);
}

/** Debug / tests: load all metadata rows (no embeddings). */
export function loadAllRows(clientOrCatalog) {
  const db = clientOrCatalog._db ?? clientOrCatalog;
  return db
    .prepare(
      `
      SELECT id, command, example, usage, intent_family, simplicity_rank,
             skill_level, intent_description, explanation, schema_version
      FROM git_commands
      `,
    )
    .all()
    .map((r) => ({
      id: r.id,
      command: r.command,
      example: r.example ?? r.command,
      usage: r.usage ?? r.example ?? r.command,
      intent_family: r.intent_family ?? '',
      simplicity_rank: Number(r.simplicity_rank ?? 1),
      skill_level: Number(r.skill_level),
      intent_description: r.intent_description,
      explanation: r.explanation,
      schema_version: Number(r.schema_version),
      embedding: null,
    }));
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
