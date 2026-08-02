// @ts-nocheck
/**
 * Iterative intent expansion: cell coverage + fidelity + embed dedup + foreign rewrite.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intentMatrixPath } from '../lib/paths.js';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import {
  IntentExpandBatchLlmResponseSchema,
  IntentRewriteLlmResponseSchema,
} from '../schemas/command.js';
import {
  IntentMatrixFileSchema,
  formatIntentMatrixForPrompt,
} from '../schemas/intentMatrix.js';
import {
  INTENT_EXPAND_BATCH,
  INTENT_EXPAND_CAP_PER_RECIPE,
  INTENT_EXPAND_ZERO_STREAK,
  INTENT_FOREIGN_COSINE,
  INTENT_FOREIGN_REWRITE_MAX,
  INTENT_WITHIN_COSINE,
} from '../db/constants.js';
import { filterIntentsForRecipe, primaryStepListing } from './intentFidelity.js';
import {
  allDecided,
  createCellState,
  emptyCells,
  formatEmptyCellsForPrompt,
  markFilled,
  markSkipped,
} from './intentExpandCells.js';
import {
  dedupeBatchByCosine,
  findForeignCollision,
  findWithinNearDup,
} from './intentSimilarity.js';
import { mockEmbed } from '../search/embed.js';

function resolveMatrixPath(explicit = null) {
  if (explicit) return explicit;
  const a = intentMatrixPath();
  if (existsSync(a)) return a;
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../taxonomy',
    'intent_matrix.json',
  );
}

/**
 * Load intent matrix and format for expand-intents.
 * @param {{ matrix?: object, matrixPath?: string }} [opts]
 * @returns {{ matrix: object, matrixText: string }}
 */
export function loadTaxonomy(opts = {}) {
  if (opts.matrix) {
    const matrix = IntentMatrixFileSchema.parse(opts.matrix);
    return { matrix, matrixText: formatIntentMatrixForPrompt(matrix) };
  }
  const filePath = resolveMatrixPath(opts.matrixPath);
  let rawText = readFileSync(filePath, 'utf8');
  if (rawText.charCodeAt(0) === 0xfeff) rawText = rawText.slice(1);
  const raw = JSON.parse(rawText);
  const matrix = IntentMatrixFileSchema.parse(raw);
  return { matrix, matrixText: formatIntentMatrixForPrompt(matrix) };
}

/**
 * @typedef {{ skill_level: string, intent_category: string, intent_text: string }} IntentItem
 * @typedef {{ embed: (text: string) => Promise<Float32Array | number[]> }} Embedder
 * @typedef {(embedding: Float32Array | number[]) =>
 *   | Promise<{ command_id: number | null, intent_text: string, similarity: number }[]>
 *   | { command_id: number | null, intent_text: string, similarity: number }[]} KnnForeign
 */

/**
 * @param {{ initial_state: string, command_recipe: object }} recipe
 * @param {{
 *   llmJsonObject?: typeof llmJsonObject,
 *   embedder?: Embedder,
 *   knnForeign?: KnnForeign | null,
 *   matrix?: object,
 *   matrixPath?: string,
 *   selfCommandId?: number | null,
 *   batchSize?: number,
 *   cap?: number,
 *   zeroStreakMax?: number,
 *   withinCosine?: number,
 *   foreignCosine?: number,
 *   rewriteMax?: number,
 * }} [opts]
 * @returns {Promise<IntentItem[]>}
 */
export async function expandIntentsForRecipe(recipe, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const embedder = opts.embedder || {
    embed: async (t) => mockEmbed(t),
  };
  const knnForeign = opts.knnForeign ?? null;
  const batchSize = opts.batchSize ?? INTENT_EXPAND_BATCH;
  const cap = opts.cap ?? INTENT_EXPAND_CAP_PER_RECIPE;
  const zeroStreakMax = opts.zeroStreakMax ?? INTENT_EXPAND_ZERO_STREAK;
  const withinCosine = opts.withinCosine ?? INTENT_WITHIN_COSINE;
  const foreignCosine = opts.foreignCosine ?? INTENT_FOREIGN_COSINE;
  const rewriteMax = opts.rewriteMax ?? INTENT_FOREIGN_REWRITE_MAX;
  const selfCommandId = opts.selfCommandId ?? null;

  const { matrixText } = loadTaxonomy({
    matrix: opts.matrix,
    matrixPath: opts.matrixPath,
  });
  const { primary, listing } = primaryStepListing(recipe);
  const cellState = createCellState();
  const isComposition =
    recipe?.mutation_kind === 'composition' || opts.composition === true;
  const composition_guidance = isComposition
    ? `COMPOSITION recipe: every intent must express the FULL multi-step goal (all major verbs/steps in the listing), not only the primary step. Example shape: "find unreachable objects and prune them" — not "prune objects" alone. Never invent verbs absent from the listing / initial_state.`
    : `Primary focus: the primary command (first step) is the topic of every intent.
Soft delta (optional): when the recipe listing or initial_state shows extra steps, distinctive flags, or a non-minimal situation, about 1–2 intents in the batch may lightly mention that cue; the rest stay primary-only. Never invent verbs, flags, or situations absent from the recipe / initial_state. Never write intents whose main topic is only a secondary step.`;

  /** @type {{ intent: IntentItem, embedding: Float32Array | number[] }[]} */
  const keepers = [];
  let zeroStreak = 0;
  let rounds = 0;
  const maxRounds = Math.max(32, Math.ceil((cap + 16) / Math.max(1, batchSize)) + zeroStreakMax);

  while (rounds < maxRounds) {
    rounds += 1;
    if (allDecided(cellState) || keepers.length >= cap || zeroStreak >= zeroStreakMax) {
      break;
    }

    const empty = emptyCells(cellState);
    if (!empty.length) break;

    const { messages } = renderPrompt('build/expand-intents', {
      matrix: matrixText,
      empty_cells: formatEmptyCellsForPrompt(empty),
      batch_size: String(batchSize),
      primary,
      listing,
      initial_state: recipe.initial_state,
      composition_guidance,
    });

    const result = await call({
      schema: IntentExpandBatchLlmResponseSchema,
      messages,
    });

    for (const skip of result.skips || []) {
      markSkipped(cellState, skip.skill_level, skip.intent_category, skip.reason);
    }

    const filtered = filterIntentsForRecipe(recipe, result.intents || [], {
      cap: batchSize,
    });

    /** @type {{ intent: IntentItem, embedding: Float32Array | number[] }[]} */
    const embedded = [];
    for (const intent of filtered) {
      const embedding = await embedder.embed(intent.intent_text);
      embedded.push({ intent, embedding });
    }

    const batchUnique = dedupeBatchByCosine(
      embedded.map((e) => ({ ...e.intent, embedding: e.embedding, _intent: e.intent })),
      withinCosine,
    ).map((row) => ({
      intent: row._intent || {
        skill_level: row.skill_level,
        intent_category: row.intent_category,
        intent_text: row.intent_text,
      },
      embedding: row.embedding,
    }));

    let added = 0;
    for (let candidate of batchUnique) {
      if (keepers.length >= cap) break;

      const within = findWithinNearDup(
        candidate.embedding,
        keepers.map((k) => ({ intent_text: k.intent.intent_text, embedding: k.embedding })),
        withinCosine,
      );
      if (within.dup) continue;

      let accepted = candidate;
      if (knnForeign) {
        let rewrites = 0;
        while (true) {
          const hits = await knnForeign(accepted.embedding);
          const foreign = findForeignCollision(hits, selfCommandId, foreignCosine);
          if (!foreign.collision) break;
          if (rewrites >= rewriteMax) {
            accepted = null;
            break;
          }
          rewrites += 1;
          const rewritten = await rewriteIntentContrast({
            call,
            recipe,
            primary,
            listing,
            intent: accepted.intent,
            neighborText: foreign.neighbor?.intent_text || '',
          });
          if (!rewritten) {
            accepted = null;
            break;
          }
          const refiltered = filterIntentsForRecipe(recipe, [rewritten], { cap: 1 });
          if (!refiltered.length) {
            accepted = null;
            break;
          }
          const nextIntent = refiltered[0];
          const nextEmb = await embedder.embed(nextIntent.intent_text);
          const withinAfter = findWithinNearDup(
            nextEmb,
            keepers.map((k) => ({ intent_text: k.intent.intent_text, embedding: k.embedding })),
            withinCosine,
          );
          if (withinAfter.dup) {
            accepted = null;
            break;
          }
          accepted = { intent: nextIntent, embedding: nextEmb };
        }
      }

      if (!accepted) continue;

      keepers.push(accepted);
      markFilled(cellState, accepted.intent.skill_level, accepted.intent.intent_category);
      added += 1;
    }

    if (added === 0) zeroStreak += 1;
    else zeroStreak = 0;

    if (keepers.length >= cap || allDecided(cellState)) break;
  }

  return keepers.map((k) => k.intent);
}

/**
 * @param {{
 *   call: typeof llmJsonObject,
 *   recipe: object,
 *   primary: string,
 *   listing: string,
 *   intent: IntentItem,
 *   neighborText: string,
 * }} args
 */
async function rewriteIntentContrast(args) {
  const { call, recipe, primary, listing, intent, neighborText } = args;
  const { messages } = renderPrompt('build/rewrite-intent-contrast', {
    skill_level: intent.skill_level,
    intent_category: intent.intent_category,
    primary,
    listing,
    initial_state: recipe.initial_state,
    intent_text: intent.intent_text,
    neighbor_text: neighborText || '(unknown)',
  });
  try {
    const result = await call({
      schema: IntentRewriteLlmResponseSchema,
      messages,
    });
    const text = String(result.intent_text || '').trim();
    if (!text) return null;
    return {
      skill_level: intent.skill_level,
      intent_category: intent.intent_category,
      intent_text: text,
    };
  } catch {
    return null;
  }
}

/**
 * Persist-time prune: drop if within-near-dup of existing or foreign collision.
 * @param {{
 *   intent_text: string,
 *   embedding: Float32Array | number[],
 *   existingEmbeddings: (Float32Array | number[])[],
 *   knnForeign?: KnnForeign | null,
 *   selfCommandId?: number | null,
 *   withinCosine?: number,
 *   foreignCosine?: number,
 * }} args
 */
export async function shouldPersistIntent(args) {
  const withinCosine = args.withinCosine ?? INTENT_WITHIN_COSINE;
  const foreignCosine = args.foreignCosine ?? INTENT_FOREIGN_COSINE;
  const within = findWithinNearDup(
    args.embedding,
    (args.existingEmbeddings || []).map((embedding, i) => ({
      intent_text: String(i),
      embedding,
    })),
    withinCosine,
  );
  if (within.dup) return { ok: false, reason: 'within_near_dup' };

  if (args.knnForeign) {
    const hits = await args.knnForeign(args.embedding);
    const foreign = findForeignCollision(hits, args.selfCommandId ?? null, foreignCosine);
    if (foreign.collision) return { ok: false, reason: 'foreign_collision' };
  }
  return { ok: true };
}
