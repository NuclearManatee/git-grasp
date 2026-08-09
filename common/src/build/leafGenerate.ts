// @ts-nocheck
/**
 * Per-leaf recipe generation batches.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import { LeafRecipeLlmSchema } from '../schemas/recipe.js';
import { LEAF_GENERATE_BATCH } from '../db/constants.js';
import { validateRecipeCandidate } from './recipeValidate.js';
import {
  commandFingerprint,
  findRecipeByFingerprint,
  insertRecipe,
  listRecipesByLeaf,
  recipeEmbedText,
} from '../db/schema.js';
import { cosineSimilarity } from '../db/utils.js';
import { RECIPE_DESC_NEAR_DUP_COSINE } from '../db/constants.js';
import {
  fixtureLabel,
  inferFixtureForLeaf,
  SandboxFixtureSchema,
} from './sandboxFixtures.js';
import {
  needsPlaceholderRewrite,
  rewriteCommandsPlaceholders,
} from './argvNormalize.js';

export const LeafGenerateBatchLlmSchema = z.object({
  recipes: z.array(LeafRecipeLlmSchema).min(1),
});

function stableId(leafId, fingerprint, title) {
  return createHash('sha256')
    .update(`${leafId}\n${fingerprint}\n${title}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Generate + validate a batch for one leaf. Returns accepted recipes.
 */
export async function generateLeafBatch(leaf, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const batchSize = opts.batchSize ?? LEAF_GENERATE_BATCH;
  const db = opts.db;
  const embed = opts.embed; // async (text) => Float32Array
  const existing = db ? listRecipesByLeaf(db, leaf.id) : opts.existing || [];
  const existingDescs = existing.map((r) => r.description).slice(0, 20);
  const preferredFixture = inferFixtureForLeaf(leaf);

  const { messages } = renderPrompt('build/generate-leaf-recipe', {
    leaf_id: leaf.id,
    leaf_name: leaf.name,
    leaf_description: leaf.description,
    mapped_commands: (leaf.mapped_commands || []).join(', '),
    batch_size: String(batchSize),
    preferred_fixture: preferredFixture,
    existing_descriptions: existingDescs.join('\n---\n') || '(none)',
  });

  const drafted = await call({
    schema: LeafGenerateBatchLlmSchema,
    messages,
  });

  const accepted = [];
  const rejected = [];
  const existingEmbs = [];
  if (embed && existing.length) {
    for (const r of existing) {
      existingEmbs.push({
        id: r.id,
        emb: await embed(recipeEmbedText(r)),
      });
    }
  }

  for (const raw of drafted.recipes || []) {
    // Canonicalize demo literals → <placeholders> before identity checks.
    const rewrittenSteps = rewriteCommandsPlaceholders(raw.commands);
    const rewritten = { ...raw, commands: rewrittenSteps };
    const didRewrite = (raw.commands || []).some((s, i) =>
      needsPlaceholderRewrite(s?.command),
    );

    const fp = commandFingerprint(rewritten.commands);
    if (db) {
      const dup = findRecipeByFingerprint(db, fp);
      if (dup && dup.taxonomy_leaf === leaf.id) {
        rejected.push({
          reason: didRewrite ? 'fingerprint_dup_after_rewrite' : 'fingerprint_dup',
          title: raw.title,
        });
        continue;
      }
    }

    // Also reject if another candidate in this batch already claimed the fp
    if (accepted.some((a) => a.command_fingerprint === fp || commandFingerprint(a.commands) === fp)) {
      rejected.push({ reason: 'fingerprint_dup_batch', title: raw.title });
      continue;
    }

    let emb = null;
    if (embed) {
      emb = await embed(
        recipeEmbedText({ ...rewritten, paraphrases: rewritten.paraphrases || [] }),
      );
      let near = false;
      for (const e of existingEmbs) {
        if (cosineSimilarity(emb, e.emb) >= RECIPE_DESC_NEAR_DUP_COSINE) {
          near = true;
          break;
        }
      }
      if (!near) {
        for (const a of accepted) {
          if (
            a._emb &&
            cosineSimilarity(emb, a._emb) >= RECIPE_DESC_NEAR_DUP_COSINE
          ) {
            near = true;
            break;
          }
        }
      }
      if (near) {
        rejected.push({ reason: 'desc_near_dup', title: raw.title });
        continue;
      }
    }

    // Prefer LLM fixture; fall back to leaf hint if missing/invalid.
    const fixtureParsed = SandboxFixtureSchema.safeParse(rewritten.fixture);
    const fixture = fixtureParsed.success
      ? fixtureParsed.data
      : preferredFixture;

    const candidate = {
      ...rewritten,
      fixture,
      initial_state: fixtureLabel(fixture),
      id: stableId(leaf.id, fp, rewritten.title),
      taxonomy_leaf: leaf.id,
      provenance: opts.provenance || 'synthetic',
      paraphrases: rewritten.paraphrases || [],
      command_fingerprint: fp,
    };

    const validated = await validateRecipeCandidate(candidate, {
      ...opts,
      llmJsonObject: call,
    });
    if (!validated.ok) {
      rejected.push({
        reason: validated.reason,
        stage: validated.stage,
        title: raw.title,
      });
      continue;
    }

    const recipe = validated.recipe;
    if (db) {
      insertRecipe(db, recipe, emb);
    }
    if (emb) {
      existingEmbs.push({ id: recipe.id, emb });
      recipe._emb = emb;
    }
    accepted.push(recipe);
  }

  return {
    accepted,
    rejected,
    distinctNew: accepted.length,
    batchSize: (drafted.recipes || []).length,
  };
}
