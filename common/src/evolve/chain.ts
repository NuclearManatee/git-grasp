// @ts-nocheck
/**
 * Map feeder items into EXPAND triage + optional corpus version / ship.
 */
import { existsSync } from 'node:fs';
import { openDb, promoteStagingDb } from '../db/schema.js';
import { buildStagingDbPath, defaultDbPath } from '../lib/paths.js';
import { triageFailure, applyTriageAction } from '../build/improveTriage.js';
import { writeCorpusVersion } from '../build/corpusVersion.js';
import { loadRegressionSet, evaluateRegressionSet } from '../build/regressionSet.js';
import { runLeafHoldout } from '../build/leafHoldout.js';
import { search } from '../search/index.js';

/**
 * @param {import('./schemas.js').FeederItem} item
 */
export function feederToFailure(item) {
  const emptyExpected = !item.expectedId;
  return {
    query: item.query,
    expectedId: item.expectedId || '',
    displayedIds: item.displayedIds || [],
    leafId: item.leafId || '',
    leafIds: item.leafIds || [],
    topLeaf: '',
    hit: false,
    // Observe misses have no known correct recipe — do not pretend one exists.
    correctExists: emptyExpected ? false : item.correctExists !== false,
    journey: item.journey || [],
    source: 'observe',
    confidence: item.confidence,
    status: item.status,
  };
}

/**
 * Catalog merge gates for --ship (leaf held-out + regression).
 * @param {object} opts
 */
export async function assertShipCatalogGates(opts = {}) {
  const searchFn =
    opts.search ||
    ((q) =>
      search(q, {
        db: opts.db,
        dbPath: opts.stagingPath || opts.dbPath,
        ...(opts.searchOpts || {}),
      }));

  const regression = loadRegressionSet(opts.regressionPath);
  const regEval = await evaluateRegressionSet(regression, {
    search: searchFn,
    minAccuracy: opts.minAccuracy ?? 0.95,
  });
  if (!regEval.ok) {
    return {
      ok: false,
      error: `regression gate failed accuracy=${regEval.accuracy} total=${regEval.total}`,
      regression: regEval,
    };
  }

  if (opts.heldoutOk === true) {
    return { ok: true, regression: regEval, heldout: { ok: true, skipped: 'heldoutOk' } };
  }

  if (typeof opts.heldoutGate === 'function') {
    const h = await opts.heldoutGate(opts);
    if (!h?.ok) {
      return {
        ok: false,
        error: h?.error || 'held-out gate failed',
        regression: regEval,
        heldout: h,
      };
    }
    return { ok: true, regression: regEval, heldout: h };
  }

  const leaves = opts.leaves || [];
  if (!leaves.length) {
    return {
      ok: false,
      error:
        'ship requires held-out gate (pass leaves, heldoutOk, or heldoutGate) or use --ship-unsafe',
      regression: regEval,
    };
  }

  const holdoutFn = opts.runLeafHoldout || runLeafHoldout;
  for (const leaf of leaves) {
    const hold = await holdoutFn(leaf, {
      ...opts,
      db: opts.db,
      search: opts.search,
      embed: opts.embed,
      llmJsonObject: opts.llmJsonObject,
    });
    if (!hold?.ok) {
      return {
        ok: false,
        error: `held-out gate failed for leaf ${leaf.id}`,
        regression: regEval,
        heldout: hold,
      };
    }
  }
  return { ok: true, regression: regEval, heldout: { ok: true, leaves: leaves.length } };
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
    /** @type {object|undefined} */
    let ship_gates;

    if (opts.writeVersion !== false && opts.allowVersionBump) {
      corpus = writeCorpusVersion(db, {});
    }

    if (opts.ship && corpus) {
      if (!opts.shipUnsafe) {
        ship_gates = await assertShipCatalogGates({
          ...opts,
          db,
          stagingPath,
        });
        if (!ship_gates.ok) {
          return {
            ok: false,
            triaged,
            results,
            corpus_version: corpus?.version ?? null,
            shipped: false,
            ship_gates,
            error: ship_gates.error,
          };
        }
      } else {
        ship_gates = { ok: true, skipped: 'ship-unsafe' };
      }
      promoteStagingDb(stagingPath, opts.prodPath || defaultDbPath());
      shipped = true;
    }

    return {
      ok: true,
      triaged,
      results,
      corpus_version: corpus?.version ?? null,
      shipped,
      ship_gates,
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
