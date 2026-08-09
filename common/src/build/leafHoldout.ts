// @ts-nocheck
/**
 * Per-leaf held-out hybrid retrieval gate.
 *
 * Queries are leaf-scoped (persona NL about the leaf goal). Hit@10 means
 * any recipe from that leaf appears in the top fused results (display ∪ top-10).
 */
import { z } from 'zod';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import {
  HELDOUT_MIN_ACCURACY,
  HELDOUT_PASS_ROUNDS,
  HELDOUT_QUERIES_PER_ROUND,
} from '../db/constants.js';
import { listRecipesByLeaf } from '../db/schema.js';

export const HeldoutQueriesLlmSchema = z.object({
  queries: z.array(z.string().min(1)).min(1),
});

/**
 * @param {{ query: string, expectedId: string, hit: boolean }[]} results
 */
export function heldoutAccuracy(results) {
  if (!results.length) return 0;
  const hits = results.filter((r) => r.hit).length;
  return hits / results.length;
}

/**
 * Generate held-out queries (not indexed) and score against hybrid search.
 * @param leaf
 * @param opts.search async (query) => { displayResults: { command_id }[] }
 */
export async function runLeafHoldout(leaf, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const count = opts.count ?? HELDOUT_QUERIES_PER_ROUND;
  const minAcc = opts.minAccuracy ?? HELDOUT_MIN_ACCURACY;
  const passRounds = opts.passRounds ?? HELDOUT_PASS_ROUNDS;
  const db = opts.db;
  const recipes = db
    ? listRecipesByLeaf(db, leaf.id)
    : opts.recipes || [];
  if (!recipes.length) {
    return { ok: false, reason: 'no_recipes', rounds: [] };
  }

  const leafRecipeIds = new Set(recipes.map((r) => String(r.id)));
  const rounds = [];
  let streak = 0;

  for (let r = 0; r < passRounds + 2 && streak < passRounds; r += 1) {
    const persona =
      r % 2 === 0
        ? 'frustrated beginner who avoids git jargon'
        : 'busy intermediate describing symptoms, not commands';
    const { messages } = renderPrompt('build/heldout-queries', {
      leaf_name: leaf.name,
      leaf_description: leaf.description,
      count: String(count),
      persona,
    });
    const drafted = await call({
      schema: HeldoutQueriesLlmSchema,
      messages,
    });
    const queries = (drafted.queries || []).slice(0, count);

    const results = [];
    for (let i = 0; i < queries.length; i += 1) {
      const expected = recipes[i % recipes.length];
      const searchResult = await opts.search(queries[i]);
      const recallK = opts.recallK ?? 10;
      const pool = [
        ...(searchResult?.displayResults || []),
        ...(searchResult?.results || []).slice(0, recallK),
      ];
      const ranked = [];
      const seen = new Set();
      for (const h of pool) {
        const id = String(h.command_id ?? h.recipe_id ?? h.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ranked.push(id);
      }
      const matchedId = ranked.find((id) => leafRecipeIds.has(id));
      const hit = Boolean(matchedId);
      results.push({
        query: queries[i],
        expectedId: matchedId || String(expected.id),
        leafId: leaf.id,
        hit,
        displayed: ranked.slice(0, 3),
        ranked,
      });
    }
    const accuracy = heldoutAccuracy(results);
    const passed = accuracy >= minAcc;
    rounds.push({ round: r + 1, accuracy, passed, results });
    if (passed) streak += 1;
    else streak = 0;
  }

  return {
    ok: streak >= passRounds,
    streak,
    rounds,
    minAccuracy: minAcc,
    passRounds,
  };
}
