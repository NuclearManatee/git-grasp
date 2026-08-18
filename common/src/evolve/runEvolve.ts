// @ts-nocheck
/**
 * EVOLVE orchestrator: PULL → FILTER → THREAD → feeder → optional EXPAND chain.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { filterSearchEvents } from './filter.js';
import { buildThreads, journeysToFeeder } from './thread.js';
import { splitFeederHoldout } from './split.js';
import { maybeLlmConfirmLabels } from './llmLabel.js';
import { readEvolveCursor, writeEvolveCursor } from './cursor.js';
import {
  resolvePosthogPullConfig,
  pullPosthogEvents,
} from './posthogPull.js';
import { chainExpandFromFeeder, scoreObserveHoldout } from './chain.js';
import { FeederItemSchema, EvolveStatsSchema } from './schemas.js';
import {
  evolveLocalDir,
  evolveFeederTrainPath,
  evolveFeederHoldoutPath,
  evolveStatsJsonPath,
  repoRoot,
} from './paths.js';
import { renderEvolveLatestMd } from './renderLatest.js';

/**
 * @param {object} [opts]
 * @param {object[]} [opts.events] — skip pull when provided (tests)
 * @param {boolean} [opts.noChain]
 * @param {boolean} [opts.llmLabel] — opt-in only; bare OPENAI_API_KEY does not auto-enable
 * @param {boolean} [opts.ship]
 * @param {boolean} [opts.shipUnsafe] — skip held-out/regression gates when shipping
 * @param {string|number} [opts.catalogVersion]
 * @param {boolean} [opts.allowVersionBump] — set true after gates in full expand; default false for triage-only
 * @param {string} [opts.root]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {Function} [opts.triageFailure]
 * @param {Function} [opts.applyTriageAction]
 * @param {Function} [opts.searchFn]
 * @param {object} [opts.db]
 * @param {boolean} [opts.writeDocs]
 */
export async function runEvolve(opts = {}) {
  const root = opts.root || repoRoot();
  const env = opts.env || process.env;
  mkdirSync(evolveLocalDir(root), { recursive: true });

  const drop_reasons = {};
  let pulled = [];
  let pullMeta = {};
  /** @type {{ last_pulled_at: string|null, last_event_id: string|null }|null} */
  let pendingCursor = null;

  if (opts.events) {
    pulled = opts.events;
    pullMeta = { source: 'fixture' };
  } else {
    const cfg = resolvePosthogPullConfig(env);
    const cursor = readEvolveCursor(root);
    const result = await pullPosthogEvents({
      apiHost: cfg.apiHost,
      projectId: cfg.projectId || env.GIT_GRASP_POSTHOG_PROJECT_ID,
      personalApiKey: cfg.personalApiKey,
      sinceIso: cursor.last_pulled_at,
      afterEventId: cursor.last_event_id,
      fetchImpl: opts.fetchImpl,
    });
    pulled = result.events;
    pullMeta = { source: 'posthog', endpoint: result.endpoint, host: cfg.apiHost };
    const newest = pulled.reduce((acc, e) => {
      const t = e.createdAt;
      const ms = typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(String(t));
      return Number.isFinite(ms) && ms > acc ? ms : acc;
    }, cursor.last_pulled_at ? Date.parse(cursor.last_pulled_at) : 0);
    const lastId = pulled.length ? pulled[pulled.length - 1].id : cursor.last_event_id;
    pendingCursor = {
      last_pulled_at: newest
        ? new Date(newest).toISOString()
        : cursor.last_pulled_at || new Date().toISOString(),
      last_event_id: lastId || null,
    };
  }

  writeFileSync(
    `${evolveLocalDir(root)}/raw-latest.json`,
    `${JSON.stringify({ at: new Date().toISOString(), pullMeta, events: pulled }, null, 2)}\n`,
  );

  const filtered = filterSearchEvents(pulled, {
    catalogVersion: opts.catalogVersion,
  });
  Object.assign(drop_reasons, filtered.drop_reasons);

  if (filtered.refused) {
    const stats = EvolveStatsSchema.parse({
      at: new Date().toISOString(),
      catalog_version_in: opts.catalogVersion ?? null,
      pulled: pulled.length,
      filtered_kept: 0,
      filtered_dropped: pulled.length,
      drop_reasons,
      threads: 0,
      feeder_train: 0,
      feeder_holdout: 0,
      chain: { ran: false },
    });
    writeStats(stats, root, opts.writeDocs !== false);
    // Durable stats written — advance cursor so a refuse does not re-pull forever
    if (pendingCursor) writeEvolveCursor(pendingCursor, root);
    return { ok: false, refused: true, stats, feederTrain: [], feederHoldout: [] };
  }

  let { journeys, droppedOversized } = buildThreads(filtered.events);
  if (droppedOversized) drop_reasons.thread_oversized = droppedOversized;

  // LLM label is strictly opt-in via --llm-label / opts.llmLabel === true
  const useLlm = opts.llmLabel === true;
  if (useLlm) {
    journeys = await maybeLlmConfirmLabels(journeys, {
      enabled: true,
      llmJsonObject: opts.llmJsonObject,
    });
  }

  const feederAll = journeysToFeeder(journeys).map((item) => FeederItemSchema.parse(item));
  const { train, holdout } = splitFeederHoldout(feederAll);

  writeFileSync(evolveFeederTrainPath(root), `${JSON.stringify(train, null, 2)}\n`);
  writeFileSync(evolveFeederHoldoutPath(root), `${JSON.stringify(holdout, null, 2)}\n`);

  /** @type {import('./schemas.js').EvolveStats['chain']} */
  let chain = { ran: false };

  if (!opts.noChain) {
    const chainResult = await chainExpandFromFeeder(train, {
      db: opts.db,
      stagingPath: opts.stagingPath,
      ship: Boolean(opts.ship),
      shipUnsafe: Boolean(opts.shipUnsafe),
      allowVersionBump: opts.allowVersionBump === true || Boolean(opts.ship),
      triageFailure: opts.triageFailure,
      applyTriageAction: opts.applyTriageAction,
      embed: opts.embed,
      search: opts.search,
      leaves: opts.leaves,
      heldoutOk: opts.heldoutOk,
      heldoutGate: opts.heldoutGate,
      regressionPath: opts.regressionPath,
      llmJsonObject: opts.llmJsonObject,
      runLeafHoldout: opts.runLeafHoldout,
    });
    let holdoutScore = { hit_rate: null };
    if (chainResult.ok) {
      holdoutScore = await scoreObserveHoldout(holdout, {
        searchFn: opts.searchFn,
        searchOpts: opts.searchOpts,
      });
    }
    chain = {
      ran: true,
      ok: Boolean(chainResult.ok),
      triaged: chainResult.triaged || 0,
      observe_holdout_hit_rate: holdoutScore.hit_rate,
      corpus_version: chainResult.corpus_version ?? null,
      shipped: Boolean(chainResult.shipped),
      error: chainResult.error,
      ship_gates: chainResult.ship_gates,
    };
  }

  const stats = EvolveStatsSchema.parse({
    at: new Date().toISOString(),
    catalog_version_in: filtered.catalog_version ?? opts.catalogVersion ?? null,
    catalog_version_out: chain.corpus_version ?? null,
    pulled: pulled.length,
    filtered_kept: filtered.events.length,
    filtered_dropped: pulled.length - filtered.events.length,
    drop_reasons,
    threads: journeys.length,
    feeder_train: train.length,
    feeder_holdout: holdout.length,
    chain,
  });
  writeStats(stats, root, opts.writeDocs !== false);

  // Advance cursor only after durable feeder + stats write
  if (pendingCursor) writeEvolveCursor(pendingCursor, root);

  return {
    ok: !chain.ran || Boolean(chain.ok),
    stats,
    feederTrain: train,
    feederHoldout: holdout,
    journeys,
    pullMeta,
  };
}

function writeStats(stats, root, writeDocs) {
  writeFileSync(evolveStatsJsonPath(root), `${JSON.stringify(stats, null, 2)}\n`);
  if (writeDocs) {
    renderEvolveLatestMd(stats, root);
  }
}

/** @deprecated stub name — prefer runEvolve */
export async function evolveFromObservedQueries(opts = {}) {
  return runEvolve(opts);
}

export const EVOLVE_STATUS = 'implemented';
