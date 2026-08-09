// @ts-nocheck
/**
 * Build a web-shippable catalog DB: relational + FTS + recipe_embeddings BLOBs.
 * No vec0. Model weights are separate.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  openDb,
  finalizeSearchIndex,
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
  void thresholdsPath;
  if (!existsSync(sourceDbPath)) {
    throw new Error(`Source DB missing: ${sourceDbPath}`);
  }
  mkdirSync(path.dirname(outPath), { recursive: true });
  copyFileSync(sourceDbPath, outPath);

  const db = openDb(outPath);
  try {
    finalizeSearchIndex(db);

    db.exec(`
CREATE TABLE IF NOT EXISTS recipe_embeddings (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL
);
DELETE FROM recipe_embeddings;
`);

    const hasVec = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name='vec_recipes'",
      )
      .get();
    if (hasVec) {
      const rows = db.prepare('SELECT id, embedding FROM vec_recipes').all();
      const ins = db.prepare(
        'INSERT INTO recipe_embeddings (id, embedding) VALUES (?, ?)',
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
      db.exec('DROP TABLE IF EXISTS vec_recipes;');
    }

    // Compat alias for older web packs
    db.exec(`
CREATE TABLE IF NOT EXISTS intent_embeddings (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL
);
DELETE FROM intent_embeddings;
INSERT INTO intent_embeddings (id, embedding)
  SELECT id, embedding FROM recipe_embeddings;
`);

    const setMeta = db.prepare(
      'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    );
    setMeta.run('search_algorithm_version', String(SEARCH_ALGORITHM_VERSION));
    setMeta.run('schema_version', String(SCHEMA_VERSION));
    setMeta.run('embedding_dim', String(EMBEDDING_DIM));
  } finally {
    db.close();
  }

  const size = statSync(outPath).size;
  if (size > WEB_CATALOG_MAX_BYTES) {
    throw new Error(
      `web catalog ${outPath} is ${size} bytes (max ${WEB_CATALOG_MAX_BYTES})`,
    );
  }
  writeChecksumFile(outPath);
  return { outPath, size };
}
