// @ts-nocheck
/**
 * Growing regression query set — must pass before corpus version ship.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { evalDataDir } from '../lib/paths.js';

export const RegressionRowSchema = z.object({
  query: z.string().min(1),
  recipe_id: z.string().min(1),
  source: z.enum(['synthetic', 'heldout', 'real', 'triage']).default('synthetic'),
  leaf_id: z.string().optional(),
});

export const RegressionSetSchema = z.object({
  version: z.number().int().nonnegative(),
  queries: z.array(RegressionRowSchema),
});

export function regressionSetPath() {
  return path.join(evalDataDir(), 'regression.json');
}

export function loadRegressionSet(filePath = regressionSetPath()) {
  if (!existsSync(filePath)) {
    return { version: 0, queries: [] };
  }
  return RegressionSetSchema.parse(
    JSON.parse(readFileSync(filePath, 'utf8')),
  );
}

export function saveRegressionSet(set, filePath = regressionSetPath()) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const parsed = RegressionSetSchema.parse(set);
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return filePath;
}

export function addRegressionQueries(set, rows) {
  const seen = new Set(set.queries.map((q) => `${q.query}::${q.recipe_id}`));
  const next = { ...set, queries: [...set.queries] };
  for (const row of rows) {
    const parsed = RegressionRowSchema.parse(row);
    const key = `${parsed.query}::${parsed.recipe_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.queries.push(parsed);
  }
  next.version = (next.version || 0) + 1;
  return next;
}

/** Drop rows whose recipe_id is not in the current catalog. */
export function pruneRegressionSet(set, extantIds) {
  const allow = extantIds instanceof Set ? extantIds : new Set(extantIds || []);
  const queries = (set.queries || []).filter((q) => allow.has(String(q.recipe_id)));
  if (queries.length === (set.queries || []).length) return set;
  return {
    version: (set.version || 0) + 1,
    queries,
  };
}

export function emptyRegressionSet() {
  return { version: 0, queries: [] };
}

/**
 * @param set
 * @param opts.search async (q) => { displayResults, results }
 */
export async function evaluateRegressionSet(set, opts = {}) {
  const recallK = opts.recallK ?? 10;
  const results = [];
  for (const row of set.queries) {
    const res = await opts.search(row.query);
    const pool = [
      ...(res?.displayResults || []),
      ...(res?.results || []).slice(0, recallK),
    ];
    const ranked = [];
    const seen = new Set();
    for (const h of pool) {
      const id = String(h.command_id ?? h.recipe_id ?? h.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ranked.push(id);
    }
    const hit = ranked.includes(String(row.recipe_id));
    results.push({ ...row, hit, displayed: ranked.slice(0, 3), ranked });
  }
  const hits = results.filter((r) => r.hit).length;
  const accuracy = results.length ? hits / results.length : 1;
  const minAcc = opts.minAccuracy ?? 0.95;
  const minTotal = opts.minTotal ?? 1;
  return {
    ok: results.length >= minTotal && accuracy >= minAcc,
    accuracy,
    hits,
    total: results.length,
    results,
  };
}
