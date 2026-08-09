// @ts-nocheck
/**
 * Leaf-parallel catalog orchestrator (taxonomy → generate/saturate → holdout → improve).
 */
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import {
  openDb,
  finalizeSearchIndex,
  promoteStagingDb,
  knnRecall,
  ftsRecall,
  getRecipe,
  loadGitVerbs,
  listRecipes,
  appendParaphrase,
  recipeEmbedText,
  upsertRecipeEmbedding,
} from '../db/schema.js';
import {
  buildStagingDbPath,
  buildCacheDir,
  defaultDbPath,
  goalTaxonomyPath,
} from '../lib/paths.js';
import { LEAF_CONCURRENCY, HELDOUT_IMPROVE_ROUNDS } from '../db/constants.js';
import { readGoalTaxonomy } from './goalTaxonomy.js';
import { saturateLeaf } from './leafSaturate.js';
import { runLeafHoldout } from './leafHoldout.js';
import {
  triageFailure,
  applyTriageAction,
  clusterGapQueries,
  expandTaxonomyFromGapClusters,
  classifyMissHeuristic,
} from './improveTriage.js';
import {
  loadRegressionSet,
  saveRegressionSet,
  addRegressionQueries,
  evaluateRegressionSet,
  emptyRegressionSet,
} from './regressionSet.js';
import { writeCorpusVersion } from './corpusVersion.js';
import { getEmbedder } from '../search/embed.js';
import { searchHybrid, normalizeQuery } from '../search/hybrid.js';
import { parseCommands, primaryCommand, renderSnippet } from '../db/recipeFormat.js';
import { loadThresholds } from '../search/index.js';
import { inferFixtureForLeaf } from './sandboxFixtures.js';

function log(...args) {
  console.log(`[build]`, ...args);
}

/**
 * Prefer diverse leaves for smoke caps: spread by preferred fixture, then by
 * primary mapped verb, instead of taking the first N near-duplicate siblings.
 */
export function selectLeavesForCap(leaves, maxLeaves) {
  if (maxLeaves == null || maxLeaves <= 0 || leaves.length <= maxLeaves) {
    return leaves;
  }
  const remaining = [...leaves];
  const picked = [];
  const usedFixtures = new Set();
  const usedVerbs = new Set();

  const primaryVerb = (leaf) => {
    const cmd = String(leaf?.mapped_commands?.[0] || '').toLowerCase();
    const m = /\bgit\s+([a-z0-9_-]+)/.exec(cmd);
    return m ? m[1] : cmd.slice(0, 24) || leaf.id;
  };

  while (picked.length < maxLeaves && remaining.length) {
    let idx = remaining.findIndex((leaf) => {
      const fx = inferFixtureForLeaf(leaf);
      const verb = primaryVerb(leaf);
      return !usedFixtures.has(fx) && !usedVerbs.has(verb);
    });
    if (idx < 0) {
      idx = remaining.findIndex((leaf) => {
        const verb = primaryVerb(leaf);
        return !usedVerbs.has(verb);
      });
    }
    if (idx < 0) idx = 0;
    const [leaf] = remaining.splice(idx, 1);
    picked.push(leaf);
    usedFixtures.add(inferFixtureForLeaf(leaf));
    usedVerbs.add(primaryVerb(leaf));
  }
  return picked;
}

function wipeStaging(stagingPath) {
  mkdirSync(path.dirname(stagingPath), { recursive: true });
  if (existsSync(stagingPath)) unlinkSync(stagingPath);
}

function makeSearchFn(db, thresholds, embedder) {
  const verbs = loadGitVerbs(db);
  return async (query) => {
    const q = normalizeQuery(query);
    return searchHybrid({
      query: q,
      thresholds,
      verbs,
      embed: () => embedder.embed(q),
      knn: (vec, k) => knnRecall(db, vec, k),
      fts: (qq, k) => ftsRecall(db, qq, k),
      hydrate: (ids) =>
        ids.map((id) => {
          const row = getRecipe(db, id);
          if (!row) {
            return {
              command_id: id,
              commands: [],
              example: '',
              snippet: '',
              title: '',
              description: '',
              risk: 0,
            };
          }
          const commands = parseCommands(row.commands);
          return {
            command_id: row.id,
            commands,
            example: primaryCommand(commands),
            snippet: renderSnippet(commands),
            title: row.title,
            description: row.description,
            risk: row.risk,
          };
        }),
    });
  };
}

/**
 * Ground: parallel leaf saturation until discovery checkpoints.
 */
export async function runGroundStep(opts = {}) {
  const stagingPath = opts.stagingPath || buildStagingDbPath();
  if (opts.fresh !== false) wipeStaging(stagingPath);
  mkdirSync(buildCacheDir(), { recursive: true });

  const taxPath = opts.taxonomyPath || goalTaxonomyPath();
  const taxonomy = opts.taxonomy || readGoalTaxonomy(taxPath);
  let leaves = taxonomy.leaves || [];
  if (opts.maxLeaves != null && opts.maxLeaves > 0) {
    leaves = selectLeavesForCap(leaves, opts.maxLeaves);
    log(`leaf cap: using ${leaves.length}/${taxonomy.leaves.length} (diverse)`);
  }
  const db = openDb(stagingPath);
  const embedder = await getEmbedder({
    forceMock: opts.mockEmbeddings || process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
  });
  const embed = (text) => embedder.embed(text);
  const limit = pLimit(opts.leafConcurrency || LEAF_CONCURRENCY);
  const runLog = opts.runLog || null;

  log(`ground leaves=${leaves.length}`);
  const results = await Promise.all(
    leaves.map((leaf) =>
      limit(async () => {
        const runOnce = async () => {
          const t0 = Date.now();
          try {
            const sat = await saturateLeaf(leaf, {
              db,
              embed,
              llmJsonObject: opts.llmJsonObject,
              skipSandbox: opts.skipSandbox,
              skipLlmPlausibility: opts.skipLlmPlausibility,
              skipJudge: opts.skipJudge,
              skipBackTranslate: opts.skipBackTranslate,
              batchSize: opts.batchSize,
              maxBatches: opts.maxBatches ?? 8,
              flatBatches: opts.flatBatches,
            });
            const elapsedMs = Date.now() - t0;
            log(`leaf ${leaf.id}: checkpoint=${sat.checkpoint} accepted=${sat.totalAccepted} ${elapsedMs}ms`);
            runLog?.event?.('leaf_saturate', {
              leaf: leaf.id,
              ...sat,
              history: undefined,
              elapsedMs,
            });
            return { leafId: leaf.id, elapsedMs, ...sat };
          } catch (e) {
            const elapsedMs = Date.now() - t0;
            const message = e?.message || String(e);
            log(`leaf ${leaf.id}: ERROR ${message} ${elapsedMs}ms`);
            return {
              leafId: leaf.id,
              ok: false,
              checkpoint: false,
              totalAccepted: 0,
              history: [],
              error: message,
              elapsedMs,
            };
          }
        };
        let out = await runOnce();
        // One retry for transient LLM/network failures.
        if (out.error && /fetch failed|socket|ECONNRESET|ETIMEDOUT|429|500|502|503/i.test(out.error)) {
          log(`leaf ${leaf.id}: retry after transient error`);
          out = await runOnce();
        }
        return out;
      }),
    ),
  );

  finalizeSearchIndex(db);
  db.close();
  const acceptedLeaves = results.filter((r) => (r.totalAccepted || 0) > 0);
  const errored = results.filter((r) => r.error);
  // Zero-accept / residual transient errors do not fail ground when recipes exist.
  const ok = acceptedLeaves.length > 0;
  log(
    `ground done: ok=${ok} leaves_with_recipes=${acceptedLeaves.length}/${results.length} errors=${errored.length}`,
  );
  return {
    ok,
    stagingPath,
    results,
    acceptedLeaves: acceptedLeaves.length,
    errors: errored.length,
  };
}

/**
 * Loop: held-out per leaf + improve triage (iterative) + regression + corpus version.
 */
export async function runBuildLoop(opts = {}) {
  const stagingPath = opts.stagingPath || buildStagingDbPath();
  if (opts.fresh) {
    const ground = await runGroundStep({ ...opts, fresh: true, stagingPath });
    if (!ground.ok && !opts.continueOnGroundFail) {
      return { ok: false, phase: 'ground', ground };
    }
    // Fresh staging → new recipe ids; wipe prior heldout regression rows.
    if (opts.resetRegression !== false) {
      saveRegressionSet(emptyRegressionSet());
      log('regression: reset (fresh catalog ids)');
    }
  }

  const taxPath = opts.taxonomyPath || goalTaxonomyPath();
  const taxonomy = opts.taxonomy || readGoalTaxonomy(taxPath);
  let leaves = taxonomy.leaves || [];
  if (opts.maxLeaves != null && opts.maxLeaves > 0) {
    leaves = selectLeavesForCap(leaves, opts.maxLeaves);
    log(`leaf cap: using ${leaves.length}/${taxonomy.leaves.length} (diverse)`);
  }
  const db = openDb(stagingPath);
  const embedder = await getEmbedder({
    forceMock: opts.mockEmbeddings || process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
  });
  const thresholds = loadThresholds();
  const search = makeSearchFn(db, thresholds, embedder);
  // Holdout is LLM-heavy; keep concurrency lower than ground to avoid socket storms.
  const holdLimit = pLimit(
    opts.holdoutConcurrency || Math.min(8, opts.leafConcurrency || LEAF_CONCURRENCY),
  );
  const gapPool = [];
  const improveRounds = opts.improveRounds ?? HELDOUT_IMPROVE_ROUNDS;

  // Only hold out leaves that actually produced recipes.
  const recipesByLeaf = new Set(listRecipes(db).map((r) => r.taxonomy_leaf));
  leaves = leaves.filter((leaf) => recipesByLeaf.has(leaf.id));
  log(`holdout eligible leaves=${leaves.length} (with recipes)`);

  async function triageMisses(leaf, hold) {
    const lastFail = [...(hold.rounds || [])].reverse().find((r) => !r.passed);
    if (!lastFail) return;
    let touched = false;
    for (const r of lastFail.results || []) {
      if (r.hit) continue;
      const failure = {
        query: r.query,
        expectedId: r.expectedId,
        displayedIds: r.displayed,
        leafId: leaf.id,
        leafIds: leaves.map((l) => l.id),
        hit: false,
        correctExists: true,
      };
      let classification;
      try {
        classification = await triageFailure(failure, opts);
      } catch (e) {
        classification = null;
      }
      const safe =
        classification?.bucket != null
          ? classification
          : classifyMissHeuristic(failure);
      const action = await applyTriageAction(safe, failure, {
        ...opts,
        db,
        leaf,
        leaves,
        search,
        embed: (t) => embedder.embed(t),
      });
      touched = true;
      if (action.action === 'gap_pool_enqueue') {
        const emb = await embedder.embed(failure.query);
        gapPool.push({ query: failure.query, embedding: emb });
      }
    }
    if (touched) finalizeSearchIndex(db);
  }

  log(`holdout leaves=${leaves.length} improveRounds=${improveRounds}`);
  const holdouts = await Promise.all(
    leaves.map((leaf) =>
      holdLimit(async () => {
        try {
          let hold = await runLeafHoldout(leaf, {
            db,
            search,
            llmJsonObject: opts.llmJsonObject,
            count: opts.heldoutCount,
            minAccuracy: opts.minAccuracy,
            passRounds: opts.passRounds,
          });
          let attempts = 0;
          while (!hold.ok && attempts < improveRounds) {
            attempts += 1;
            log(`leaf ${leaf.id}: holdout fail → improve ${attempts}/${improveRounds}`);
            try {
              await triageMisses(leaf, hold);
            } catch (e) {
              log(`leaf ${leaf.id}: triage error ${e?.message || e}`);
            }
            try {
              hold = await runLeafHoldout(leaf, {
                db,
                search,
                llmJsonObject: opts.llmJsonObject,
                count: opts.heldoutCount,
                minAccuracy: opts.minAccuracy,
                passRounds: opts.passRounds,
              });
            } catch (e) {
              log(`leaf ${leaf.id}: holdout retry error ${e?.message || e}`);
              break;
            }
          }
          // Last-ditch: broadcast every remaining miss query onto all leaf recipes.
          if (!hold.ok) {
            const lastFail = [...(hold.rounds || [])].reverse().find((r) => !r.passed);
            const recipes = listRecipes(db).filter((r) => r.taxonomy_leaf === leaf.id);
            if (lastFail && recipes.length) {
              try {
                for (const r of lastFail.results || []) {
                  if (r.hit) continue;
                  for (const recipe of recipes) {
                    appendParaphrase(db, recipe.id, r.query);
                    const emb = await embedder.embed(
                      recipeEmbedText({
                        ...recipe,
                        paraphrases: [...(recipe.paraphrases || []), r.query],
                      }),
                    );
                    upsertRecipeEmbedding(db, recipe.id, emb);
                  }
                }
                finalizeSearchIndex(db);
                for (let extra = 0; extra < 3 && !hold.ok; extra += 1) {
                  hold = await runLeafHoldout(leaf, {
                    db,
                    search,
                    llmJsonObject: opts.llmJsonObject,
                    count: opts.heldoutCount,
                    minAccuracy: opts.minAccuracy,
                    passRounds: opts.passRounds,
                  });
                  if (hold.ok) {
                    log(`leaf ${leaf.id}: holdout recovered via broadcast (+${extra + 1})`);
                  }
                }
              } catch (e) {
                log(`leaf ${leaf.id}: broadcast error ${e?.message || e}`);
              }
            }
          }
          log(
            `leaf ${leaf.id}: holdout=${hold.ok} streak=${hold.streak || 0} improve=${attempts}`,
          );
          return { leafId: leaf.id, improveAttempts: attempts, ...hold };
        } catch (e) {
          const message = e?.message || String(e);
          log(`leaf ${leaf.id}: holdout FATAL ${message}`);
          return {
            leafId: leaf.id,
            ok: false,
            improveAttempts: 0,
            rounds: [],
            error: message,
          };
        }
      }),
    ),
  );

  let gapProposals = [];
  if (gapPool.length) {
    const clusters = clusterGapQueries(gapPool);
    if (clusters.length) {
      gapProposals = await expandTaxonomyFromGapClusters(clusters, {
        ...opts,
        leaves,
      });
    }
  }

  // Rebuild heldout regression from this run's green leaves only; keep real/triage rows.
  const prior = loadRegressionSet();
  const extant = new Set(listRecipes(db).map((r) => String(r.id)));
  let regression = {
    version: (prior.version || 0) + 1,
    queries: (prior.queries || []).filter(
      (q) =>
        (q.source === 'real' || q.source === 'triage') &&
        extant.has(String(q.recipe_id)),
    ),
  };
  for (const h of holdouts) {
    if (!h.ok) continue;
    for (const round of h.rounds || []) {
      if (!round.passed) continue;
      for (const r of round.results || []) {
        if (!r.hit) continue;
        regression = addRegressionQueries(regression, [
          {
            query: r.query,
            recipe_id: r.expectedId,
            source: 'heldout',
            leaf_id: h.leafId,
          },
        ]);
      }
    }
  }
  saveRegressionSet(regression);
  const regEval = await evaluateRegressionSet(regression, {
    search,
    minAccuracy: opts.minAccuracy ?? 0.95,
  });
  log(
    `regression: ok=${regEval.ok} accuracy=${(regEval.accuracy ?? 0).toFixed(3)} total=${regEval.total}`,
  );

  let corpus = null;
  if (regEval.ok) {
    const holdPass = holdouts.filter((h) => h.ok).length;
    const holdRate = holdouts.length ? holdPass / holdouts.length : 0;
    const minHoldRate = opts.minHoldoutLeafRate ?? 0.8;
    if (holdRate >= minHoldRate) {
      corpus = writeCorpusVersion(db, {});
      if (opts.promote) {
        promoteStagingDb(stagingPath, opts.prodPath || defaultDbPath());
      }
    } else {
      log(
        `corpus skipped: holdout leaf rate ${(holdRate * 100).toFixed(1)}% < ${(minHoldRate * 100).toFixed(0)}%`,
      );
    }
  }

  db.close();
  const holdPass = holdouts.filter((h) => h.ok).length;
  const holdRate = holdouts.length ? holdPass / holdouts.length : 0;
  const minHoldRate = opts.minHoldoutLeafRate ?? 0.8;
  const holdOk = holdRate >= minHoldRate;
  log(
    `holdout summary: ${holdPass}/${holdouts.length} leaves (${(holdRate * 100).toFixed(1)}%, need ≥${(minHoldRate * 100).toFixed(0)}%)`,
  );
  return {
    ok: holdOk && regEval.ok,
    holdouts,
    holdPass,
    holdRate,
    gapProposals,
    regression: regEval,
    corpus,
    stagingPath,
  };
}

/** @deprecated evolve loop removed — alias to runBuildLoop */
export async function runEvolveCycle() {
  throw new Error('evolve loop removed — use runBuildLoop (leaf saturation + holdout)');
}
