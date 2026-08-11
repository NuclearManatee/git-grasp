// @ts-nocheck
/**
 * Versioned recipe corpus promote helpers.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';
import { catalogDir, localDir, PACKAGE_ROOT } from '../lib/paths.js';
import { listRecipes, finalizeSearchIndex } from '../db/schema.js';

export function corpusVersionsDir() {
  return path.join(catalogDir(), 'versions');
}

export function latestCorpusMetaPath() {
  return path.join(catalogDir(), 'recipes.latest.json');
}

/** Repo-relative posix path for release metadata (never absolute machine paths). */
export function corpusRelativePath(absolutePath) {
  const rel = path.relative(PACKAGE_ROOT, absolutePath);
  return rel.split(path.sep).join('/');
}

export function nextCorpusVersion() {
  const dir = corpusVersionsDir();
  if (!existsSync(dir)) return 1;
  const nums = readdirSync(dir)
    .map((f) => {
      const m = f.match(/^recipes\.v(\d+)\.json$/);
      return m ? Number(m[1]) : 0;
    })
    .filter((n) => n > 0);
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

/**
 * Dump staging DB recipes to versioned JSON + latest pointer.
 */
export function writeCorpusVersion(db, opts = {}) {
  const version = opts.version ?? nextCorpusVersion();
  const recipes = listRecipes(db);
  const doc = {
    version,
    created_at: new Date().toISOString(),
    recipe_count: recipes.length,
    recipes: recipes.map((r) => ({
      ...r,
      // strip ephemeral
      _emb: undefined,
    })),
    provenance_counts: recipes.reduce((acc, r) => {
      acc[r.provenance] = (acc[r.provenance] || 0) + 1;
      return acc;
    }, {}),
  };

  const dir = corpusVersionsDir();
  mkdirSync(dir, { recursive: true });
  const versionPath = path.join(dir, `recipes.v${version}.json`);
  writeFileSync(versionPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  const latest = {
    version,
    path: corpusRelativePath(versionPath),
    recipe_count: recipes.length,
    created_at: doc.created_at,
  };
  writeFileSync(
    latestCorpusMetaPath(),
    `${JSON.stringify(latest, null, 2)}\n`,
    'utf8',
  );

  // Also write flat catalog for seed (+ compat commands.json mirror)
  writeFileSync(
    path.join(catalogDir(), 'recipes.json'),
    `${JSON.stringify(doc.recipes, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(catalogDir(), 'commands.json'),
    `${JSON.stringify(doc.recipes, null, 2)}\n`,
    'utf8',
  );

  const scratch = path.join(localDir(), 'corpus');
  mkdirSync(scratch, { recursive: true });
  writeFileSync(
    path.join(scratch, 'latest.json'),
    `${JSON.stringify(latest, null, 2)}\n`,
    'utf8',
  );

  if (opts.finalize !== false) {
    finalizeSearchIndex(db);
  }

  return { version, versionPath, latest, recipe_count: recipes.length };
}

export function readLatestCorpusMeta() {
  const p = latestCorpusMetaPath();
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}
