// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, catalogDir, defaultDbPath } from './paths.js';
import { SCHEMA_VERSION } from '../db/constants.js';
import { verifyFileChecksum } from './checksum.js';
import { style } from '../ux/cliStyle.js';

let cachedAppVersion = null;

/** Test helper: drop memoized package version. */
export function resetAppVersionCacheForTests() {
  cachedAppVersion = null;
}

/**
 * Resolve published package version from package.json (root, then apps/cli).
 */
export function appVersion() {
  if (cachedAppVersion) return cachedAppVersion;
  if (process.env.npm_package_version) {
    cachedAppVersion = String(process.env.npm_package_version);
    return cachedAppVersion;
  }
  const candidates = [
    path.join(PACKAGE_ROOT, 'package.json'),
    path.join(PACKAGE_ROOT, 'apps', 'cli', 'package.json'),
  ];
  for (const file of candidates) {
    try {
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      if (pkg?.version) {
        cachedAppVersion = String(pkg.version);
        return cachedAppVersion;
      }
    } catch {
      /* try next */
    }
  }
  cachedAppVersion = '0.1.0';
  return cachedAppVersion;
}

/** @returns {{ corpusVersion: number|null, recipeCount: number|null, createdAt: string|null, path: string|null }} */
export function catalogIdentity() {
  const metaPath = path.join(catalogDir(), 'recipes.latest.json');
  if (!existsSync(metaPath)) {
    return { corpusVersion: null, recipeCount: null, createdAt: null, path: null };
  }
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const corpusVersion =
      meta?.version != null && Number.isFinite(Number(meta.version))
        ? Number(meta.version)
        : null;
    const recipeCount =
      meta?.recipe_count != null && Number.isFinite(Number(meta.recipe_count))
        ? Number(meta.recipe_count)
        : null;
    return {
      corpusVersion,
      recipeCount,
      createdAt: meta?.created_at ? String(meta.created_at) : null,
      path: metaPath,
    };
  } catch {
    return { corpusVersion: null, recipeCount: null, createdAt: null, path: metaPath };
  }
}

/**
 * @param {{ dbPath?: string }} [opts]
 * @returns {{ appVersion: string, schemaVersion: number, corpusVersion: number|null, recipeCount: number|null, dbHash12: string|null, dbOk: boolean }}
 */
export function collectVersionIdentity(opts = {}) {
  const dbPath = opts.dbPath || defaultDbPath();
  const cat = catalogIdentity();
  const check = verifyFileChecksum(dbPath);
  return {
    appVersion: appVersion(),
    schemaVersion: SCHEMA_VERSION,
    corpusVersion: cat.corpusVersion,
    recipeCount: cat.recipeCount,
    createdAt: cat.createdAt,
    dbHash12: check.ok ? String(check.hash).slice(0, 12) : null,
    dbOk: Boolean(check.ok),
    dbPath,
  };
}

/**
 * Multi-line identity for --version / doctor.
 * @param {{ dbPath?: string }} [opts]
 */
export function formatVersionReport(opts = {}) {
  const id = collectVersionIdentity(opts);
  const lines = [style.brand(`git-grasp ${id.appVersion}`)];
  const catalogPart =
    id.corpusVersion != null
      ? `catalog v${id.corpusVersion}${id.recipeCount != null ? ` (${id.recipeCount} recipes)` : ''}`
      : 'catalog unknown';
  const schemaPart = `schema v${id.schemaVersion}`;
  const dbPart = id.dbHash12 ? `db ${id.dbHash12}` : 'db missing';
  lines.push(style.muted(`${catalogPart} · ${schemaPart} · ${dbPart}`));
  return lines.join('\n');
}
