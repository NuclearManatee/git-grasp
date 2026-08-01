/**
 * Build a web-shippable catalog DB: relational + FTS + intent_embeddings BLOBs.
 * No vec0 / vec_commands. Model weights are separate (B1-A).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  openDb,
  finalizeSearchIndex,
  stripVecCommandsForShip,
  SEARCH_ALGORITHM_VERSION,
  SCHEMA_VERSION,
  EMBEDDING_DIM,
} from '../db/schema.js';
import { PACKAGE_ROOT, defaultThresholdsPath } from '../lib/paths.js';
import { writeChecksumFile } from '../lib/checksum.js';

export const WEB_CATALOG_MAX_BYTES = 100 * 1024 * 1024;

export function defaultWebCatalogPath() {
  return path.join(PACKAGE_ROOT, 'apps', 'web', 'public', 'catalog', 'web-catalog.db');
}

/**
 * Convert a product/staging DB into web catalog bytes on disk.
 */
export function exportWebCatalog(
  sourceDbPath,
  outPath = defaultWebCatalogPath(),
  { thresholdsPath = defaultThresholdsPath() } = {},
) {
  if (!existsSync(sourceDbPath)) {
    throw new Error(`Source DB missing: ${sourceDbPath}`);
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  copyFileSync(sourceDbPath, outPath);

  const db = openDb(outPath);
  try {
    finalizeSearchIndex(db);
    stripVecCommandsForShip(db);

    db.exec(`
CREATE TABLE IF NOT EXISTS intent_embeddings (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL
);
DELETE FROM intent_embeddings;
`);

    const hasVec = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name='vec_intents'",
      )
      .get();
    if (hasVec) {
      const rows = db.prepare('SELECT id, embedding FROM vec_intents').all();
      const ins = db.prepare(
        'INSERT INTO intent_embeddings (id, embedding) VALUES (?, ?)',
      );
      const tx = db.transaction(() => {
        for (const r of rows) {
          const buf =
            r.embedding instanceof Uint8Array
              ? r.embedding
              : new Uint8Array(r.embedding);
          ins.run(String(r.id), buf);
        }
      });
      tx();
      db.exec('DROP TABLE IF EXISTS vec_intents;');
    }

    const setMeta = db.prepare(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    );
    setMeta.run('search_algorithm_version', String(SEARCH_ALGORITHM_VERSION));
    setMeta.run('schema_version', String(SCHEMA_VERSION));
    setMeta.run('embedding_dim', String(EMBEDDING_DIM));
    if (existsSync(thresholdsPath)) {
      setMeta.run('thresholds_json', readFileSync(thresholdsPath, 'utf8'));
    }
  } finally {
    db.close();
  }

  const size = statSync(outPath).size;
  if (size > WEB_CATALOG_MAX_BYTES) {
    throw new Error(
      `Web catalog ${outPath} is ${size} bytes (limit ${WEB_CATALOG_MAX_BYTES})`,
    );
  }
  const hash = writeChecksumFile(outPath);
  return { outPath, size, hash, searchAlgorithmVersion: SEARCH_ALGORITHM_VERSION };
}

/** Load intent embedding rows from a web catalog DB (Node/Bun). */
export function loadIntentEmbeddingRows(db) {
  const rows = db.prepare('SELECT id, embedding FROM intent_embeddings').all();
  return rows.map((r) => {
    const buf =
      r.embedding instanceof Uint8Array
        ? r.embedding
        : new Uint8Array(r.embedding);
    const floats = new Float32Array(
      buf.buffer,
      buf.byteOffset,
      Math.floor(buf.byteLength / 4),
    );
    return { id: String(r.id), embedding: floats };
  });
}
