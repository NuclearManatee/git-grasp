// @ts-nocheck
/**
 * Automated improve triage: buckets 1/2/3.
 */
import { z } from 'zod';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import {
  GAP_POOL_MIN_CLUSTER,
  GAP_POOL_CLUSTER_COSINE,
} from '../db/constants.js';
import { cosineSimilarity } from '../db/utils.js';
import { appendParaphrase, getRecipe, listRecipes, listRecipesByLeaf, recipeEmbedText, upsertRecipeEmbedding } from '../db/schema.js';
import { saturateLeaf } from './leafSaturate.js';
import { runLeafHoldout } from './leafHoldout.js';

export const TriageBucketLlmSchema = z.object({
  bucket: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  correct_recipe_id: z.string().optional(),
  leaf_id: z.string().optional(),
  reason: z.string(),
});

export const NearbyParaphrasesLlmSchema = z.object({
  paraphrases: z.array(z.string()).default([]),
});

export const GapClusterScopeLlmSchema = z.object({
  new_leaves: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        parent_hint: z.string().optional(),
      }),
    )
    .default([]),
  notes: z.array(z.string()).default([]),
});

/**
 * Cluster gap-pool queries by embedding cosine.
 */
export function clusterGapQueries(items, opts = {}) {
  const threshold = opts.threshold ?? GAP_POOL_CLUSTER_COSINE;
  const minSize = opts.minSize ?? GAP_POOL_MIN_CLUSTER;
  const clusters = [];
  const used = new Set();
  for (let i = 0; i < items.length; i += 1) {
    if (used.has(i)) continue;
    const cluster = [items[i]];
    used.add(i);
    for (let j = i + 1; j < items.length; j += 1) {
      if (used.has(j)) continue;
      if (cosineSimilarity(items[i].embedding, items[j].embedding) >= threshold) {
        cluster.push(items[j]);
        used.add(j);
      }
    }
    if (cluster.length >= minSize) clusters.push(cluster);
  }
  return clusters;
}

export async function triageFailure(failure, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { messages } = renderPrompt('improve/triage-bucket', {
    query: failure.query,
    expected_id: failure.expectedId || '',
    displayed_ids: (failure.displayedIds || []).join(', '),
    leaf_ids: (failure.leafIds || []).join(', '),
    top_leaf: failure.topLeaf || '',
  });
  return call({ schema: TriageBucketLlmSchema, messages });
}

async function reembedAfterParaphrase(db, recipeId, embed) {
  if (!db || !embed || !recipeId) return;
  const recipe = getRecipe(db, recipeId);
  if (!recipe) return;
  const emb = await embed(recipeEmbedText(recipe));
  upsertRecipeEmbedding(db, recipeId, emb);
}

/**
 * Apply triage action for one classified failure.
 */
export async function applyTriageAction(classification, failure, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const db = opts.db;
  const bucket = classification.bucket;
  const embed = opts.embed;

  if (bucket === 1) {
    const recipeId = classification.correct_recipe_id || failure.expectedId;
    if (!recipeId || !db) {
      return { ok: false, bucket, reason: 'missing_recipe' };
    }
    const targets = new Set([String(recipeId)]);
    // Broadcast alias across the leaf so near-dup siblings also retrieve.
    if (failure.leafId) {
      for (const r of listRecipesByLeaf(db, failure.leafId)) {
        targets.add(String(r.id));
      }
    }
    let wrote = false;
    for (const id of targets) {
      if (appendParaphrase(db, id, failure.query)) wrote = true;
      await reembedAfterParaphrase(db, id, embed);
    }
    if (opts.onAlias) opts.onAlias(recipeId, failure.query);
    return { ok: true, bucket, recipeId, action: 'alias_paraphrase', wrote, aliased: targets.size };
  }

  if (bucket === 2) {
    const leaf =
      opts.leaves?.find((l) => l.id === (classification.leaf_id || failure.leafId)) ||
      opts.leaf;
    if (!leaf) return { ok: false, bucket, reason: 'missing_leaf' };
    const recipe = classification.correct_recipe_id
      ? getRecipe(db, classification.correct_recipe_id)
      : null;
    if (recipe) {
      const { messages } = renderPrompt('build/nearby-paraphrases', {
        seed_query: failure.query,
        title: recipe.title,
        description: recipe.description,
        count: '5',
      });
      const near = await call({
        schema: NearbyParaphrasesLlmSchema,
        messages,
      });
      for (const p of near.paraphrases || []) {
        appendParaphrase(db, recipe.id, p);
      }
      appendParaphrase(db, recipe.id, failure.query);
      await reembedAfterParaphrase(db, recipe.id, embed);
    }
    // Mark stale + rerun discovery + fresh holdout
    const sat = await saturateLeaf(leaf, { ...opts, provenance: 'real-failure-seeded' });
    const hold = opts.search
      ? await runLeafHoldout(leaf, opts)
      : { ok: true, skipped: true };
    return {
      ok: Boolean(sat.checkpoint && hold.ok),
      bucket,
      action: 'leaf_gap_fill',
      saturate: sat,
      holdout: hold,
    };
  }

  // bucket 3 — accumulate; caller batches clusters
  return {
    ok: true,
    bucket,
    action: 'gap_pool_enqueue',
    query: failure.query,
  };
}

/**
 * Process gap-pool clusters into new leaf proposals (auto, no human gate).
 */
export async function expandTaxonomyFromGapClusters(clusters, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const leaves = opts.leaves || (opts.db ? [] : []);
  const proposals = [];
  for (const cluster of clusters) {
    const { messages } = renderPrompt('improve/gap-cluster-scope', {
      queries_json: JSON.stringify(
        cluster.map((c) => c.query),
        null,
        2,
      ),
      leaves_json: JSON.stringify(
        leaves.slice(0, 40).map((l) => ({
          id: l.id,
          name: l.name,
          description: l.description,
        })),
        null,
        2,
      ),
    });
    const scoped = await call({
      schema: GapClusterScopeLlmSchema,
      messages,
    });
    proposals.push({
      clusterSize: cluster.length,
      queries: cluster.map((c) => c.query),
      new_leaves: scoped.new_leaves,
      notes: scoped.notes,
    });
  }
  return proposals;
}

/** Pure classifier fallback without LLM (tests). */
export function classifyMissHeuristic(failure) {
  const displayed = failure.displayedIds || [];
  // Verified recipe exists + known id + something displayed → retrieval (bucket 1).
  if (failure.correctExists === true && failure.expectedId && displayed.length) {
    return {
      bucket: 1,
      correct_recipe_id: failure.expectedId,
      reason: 'heuristic_retrieval',
    };
  }
  // Abstain / empty display → depth fill on known leaf, else taxonomy gap.
  if (!displayed.length) {
    if (failure.leafId) {
      return {
        bucket: 2,
        leaf_id: failure.leafId,
        reason: 'heuristic_abstain',
      };
    }
    return { bucket: 3, reason: 'heuristic_taxonomy_gap' };
  }
  if (failure.leafId) {
    return { bucket: 2, leaf_id: failure.leafId, reason: 'heuristic_leaf_gap' };
  }
  return { bucket: 3, reason: 'heuristic_taxonomy_gap' };
}
