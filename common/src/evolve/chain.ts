// @ts-nocheck
/**
 * Map feeder items into EXPAND triage + optional corpus version / ship.
 */
import { existsSync } from 'node:fs';
import { openDb, promoteStagingDb } from '../db/schema.js';
import { buildStagingDbPath, defaultDbPath } from '../lib/paths.js';
import { triageFailure, applyTriageAction } from '../build/improveTriage.js';
import { writeCorpusVersion } from '../build/corpusVersion.js';
import { search } from '../search/index.js';

/**
 * @param {import('./schemas.js').FeederItem} item
 */
export function feederToFailure(item) {
  return {
    query: item.query,
    expectedId: item.expectedId || '',
    displayedIds: item.displayedIds || [],
    leafId: item.leafId || '',
    leafIds: item.leafIds || [],
    topLeaf: '',
    hit: false,
    correctExists: true,
    journey: item.journey || [],
    source: 'observe',
    confidence: item.confidence,
    status: item.status,
  };
}

/**
 * @param {import('./schemas.js').FeederItem[]} train
 * @param {object} [opts]
 */
export async function chainExpandFromFeeder(train, opts = {}) {
  const stagingPath = opts.stagingPath || buildStagingDbPath();
  if (!existsSync(stagingPath) && !opts.db) {
    return {
      ok: false,
      triaged: 0,
      error: `staging DB missing at ${stagingPath}; run expand/generate first or pass opts.db`,
    };
  }
  const db = opts.db || openDb(stagingPath);
  const ownsDb = !opts.db;
  let triaged = 0;
  const results = [];
  try {
    for (const item of train || []) {
      const failure = feederToFailure(item);
      const classification = opts.triageFailure
        ? await opts.triageFailure(failure, opts)
        : await triageFailure(failure, opts);
      const applied = opts.applyTriageAction
        ? await opts.applyTriageAction(classification, failure, { ...opts, db })
        : await applyTriageAction(classification, failure, { ...opts, db });
      results.push({ classification, applied });
      triaged += 1;
    }

    let corpus = null;
    let shipped = false;
    if (opts.writeVersion !== false && opts.allowVersionBump) {
      corpus = writeCorpusVersion(db, {});
    }
    if (opts.ship && corpus) {
      promoteStagingDb(stagingPath, opts.prodPath || defaultDbPath());
      shipped = true;
    }

    return {
      ok: true,
      triaged,
      results,
      corpus_version: corpus?.version ?? null,
      shipped,
    };
  } catch (err) {
    return { ok: false, triaged, error: String(err?.message || err) };
  } finally {
    if (ownsDb && db?.close) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Score observe holdout queries with search().
 * @param {import('./schemas.js').FeederItem[]} holdout
 * @param {{ searchFn?: Function, dbPath?: string }} [opts]
 */
export async function scoreObserveHoldout(holdout, opts = {}) {
  const searchFn = opts.searchFn || search;
  if (!holdout?.length) {
    return { hit_rate: null, n: 0, hits: 0 };
  }
  let hits = 0;
  for (const item of holdout) {
    try {
      const result = await searchFn(item.query, opts.searchOpts || {});
      const status = result?.status;
      const confidence = result?.confidence ?? 0;
      const displayCount = (result?.displayResults || result?.results || []).length;
      if (status === 'ok' && confidence >= 0.4 && displayCount > 0) hits += 1;
    } catch {
      /* miss */
    }
  }
  return { hit_rate: hits / holdout.length, n: holdout.length, hits };
}
