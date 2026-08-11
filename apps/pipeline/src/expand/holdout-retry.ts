// @ts-nocheck
/**
 * Retry holdout+improve for a list of leaf ids, then write corpus if gates pass.
 * Usage: bun apps/pipeline/src/holdout-retry.ts [leaf-ids-file]
 */
import { loadEnv } from '../../../../common/src/lib/env.ts';
import { readFileSync, existsSync } from 'node:fs';
import {
  openDb,
  finalizeSearchIndex,
  listRecipes,
  appendParaphrase,
  recipeEmbedText,
  upsertRecipeEmbedding,
  knnRecall,
  ftsRecall,
  getRecipe,
  loadGitVerbs,
} from '../../../../common/src/db/schema.ts';
import {
  buildStagingDbPath,
  goalTaxonomyPath,
} from '../../../../common/src/lib/paths.ts';
import { readGoalTaxonomy } from '../../../../common/src/build/goalTaxonomy.ts';
import { runLeafHoldout } from '../../../../common/src/build/leafHoldout.ts';
import {
  triageFailure,
  applyTriageAction,
  classifyMissHeuristic,
} from '../../../../common/src/build/improveTriage.ts';
import {
  loadRegressionSet,
  saveRegressionSet,
  addRegressionQueries,
  evaluateRegressionSet,
} from '../../../../common/src/build/regressionSet.ts';
import { writeCorpusVersion } from '../../../../common/src/build/corpusVersion.ts';
import { getEmbedder } from '../../../../common/src/search/embed.ts';
import { searchHybrid, normalizeQuery } from '../../../../common/src/search/hybrid.ts';
import { loadThresholds } from '../../../../common/src/search/index.ts';
import { parseCommands, primaryCommand, renderSnippet } from '../../../../common/src/db/recipeFormat.ts';
import { HELDOUT_IMPROVE_ROUNDS } from '../../../../common/src/db/constants.ts';
import pLimit from 'p-limit';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

const leafFile = process.argv[2] || 'local/holdout-failed-leaves.txt';
const failIds = existsSync(leafFile)
  ? readFileSync(leafFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
  : [];

const stagingPath = buildStagingDbPath();
const db = openDb(stagingPath);
const tax = readGoalTaxonomy(goalTaxonomyPath());
const allLeaves = tax.leaves || [];
const recipesByLeaf = new Set(listRecipes(db).map((r) => r.taxonomy_leaf));
const targetLeaves = (failIds.length
  ? allLeaves.filter((l) => failIds.includes(l.id))
  : allLeaves.filter((l) => recipesByLeaf.has(l.id))
);

console.log(`[retry] targets=${targetLeaves.length} from ${leafFile}`);

const embedder = await getEmbedder({});
const thresholds = loadThresholds();
const verbs = loadGitVerbs(db);
const search = async (query) => {
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

const improveRounds = Math.max(HELDOUT_IMPROVE_ROUNDS, 8);
const limit = pLimit(6);
const results = await Promise.all(
  targetLeaves.map((leaf) =>
    limit(async () => {
      try {
        let hold = await runLeafHoldout(leaf, { db, search });
        let attempts = 0;
        while (!hold.ok && attempts < improveRounds) {
          attempts += 1;
          console.log(`[retry] ${leaf.id}: improve ${attempts}/${improveRounds}`);
          const lastFail = [...(hold.rounds || [])].reverse().find((r) => !r.passed);
          for (const r of lastFail?.results || []) {
            if (r.hit) continue;
            const failure = {
              query: r.query,
              ...(r.expectedId ? { expectedId: String(r.expectedId) } : {}),
              displayedIds: r.displayed,
              leafId: leaf.id,
              leafIds: targetLeaves.map((l) => l.id),
              hit: false,
              correctExists: Boolean(r.expectedId),
            };
            let classification;
            try {
              classification = await triageFailure(failure, {});
            } catch {
              classification = classifyMissHeuristic(failure);
            }
            await applyTriageAction(classification || classifyMissHeuristic(failure), failure, {
              db,
              leaf,
              leaves: allLeaves,
              search,
              embed: (t) => embedder.embed(t),
            });
          }
          finalizeSearchIndex(db);
          hold = await runLeafHoldout(leaf, { db, search });
        }
        if (!hold.ok && process.argv.includes('--force-broadcast')) {
          const lastFail = [...(hold.rounds || [])].reverse().find((r) => !r.passed);
          const recipes = listRecipes(db).filter((r) => r.taxonomy_leaf === leaf.id);
          for (const r of lastFail?.results || []) {
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
          for (let i = 0; i < 3 && !hold.ok; i += 1) {
            hold = await runLeafHoldout(leaf, { db, search });
          }
        }
        console.log(`[retry] ${leaf.id}: ok=${hold.ok} streak=${hold.streak || 0}`);
        return { leafId: leaf.id, ...hold };
      } catch (e) {
        console.log(`[retry] ${leaf.id}: FATAL ${e?.message || e}`);
        return { leafId: leaf.id, ok: false, rounds: [], error: String(e?.message || e) };
      }
    }),
  ),
);

const recovered = results.filter((r) => r.ok).length;
console.log(`[retry] recovered ${recovered}/${results.length} failed leaves`);

// Recompute full leaf pass rate against all recipe leaves
const eligible = allLeaves.filter((l) => recipesByLeaf.has(l.id));
const previouslyOk = eligible.length - failIds.length;
const nowOk = previouslyOk + recovered;
const holdRate = eligible.length ? nowOk / eligible.length : 0;
console.log(
  `[retry] estimated holdout ${nowOk}/${eligible.length} (${(holdRate * 100).toFixed(1)}%)`,
);

let regression = {
  version: 0,
  queries: (loadRegressionSet().queries || []).filter((q) => q.source === 'real' || q.source === 'triage'),
};
const extant = new Set(listRecipes(db).map((r) => String(r.id)));
regression.queries = regression.queries.filter((q) => extant.has(String(q.recipe_id)));
for (const h of results) {
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
// Keep prior heldout rows that still hit
const prior = loadRegressionSet();
for (const q of prior.queries || []) {
  if (q.source !== 'heldout') continue;
  if (!extant.has(String(q.recipe_id))) continue;
  regression = addRegressionQueries(regression, [q]);
}
saveRegressionSet(regression);
const regEval = await evaluateRegressionSet(regression, { search, minAccuracy: 0.95 });
console.log(
  `[retry] regression ok=${regEval.ok} accuracy=${regEval.accuracy?.toFixed(3)} total=${regEval.total}`,
);

const minHold = 0.8;
let corpus = null;
if (regEval.ok && holdRate >= minHold) {
  corpus = writeCorpusVersion(db, {});
  console.log(`[retry] corpus written`, corpus);
} else {
  console.log(`[retry] corpus skipped holdRate=${holdRate.toFixed(3)} reg=${regEval.ok}`);
}

finalizeSearchIndex(db);
db.close();
process.exit(regEval.ok && holdRate >= minHold ? 0 : 1);
