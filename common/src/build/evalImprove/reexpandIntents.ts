// @ts-nocheck
/**
 * Re-expand intents on staging after lexicon trap updates.
 */
import {
  listCommands,
  deleteIntentsForCommand,
  insertIntentWithEmbedding,
  knnRecall,
} from '../../db/schema.js';
import { INTENT_FOREIGN_KNN_K } from '../../db/constants.js';
import { expandIntentsForRecipe } from '../intentExpand.js';
import { makeKnnForeign } from '../intentSimilarity.js';
import { parseCommands } from '../../db/recipeFormat.js';

function recipeFromRow(row) {
  let command_recipe = row.command_recipe;
  if (typeof command_recipe === 'string') {
    try {
      command_recipe = JSON.parse(command_recipe);
    } catch {
      command_recipe = { commands: parseCommands(row.command_recipe) };
    }
  }
  return {
    initial_state: row.initial_state,
    command_recipe,
    mutation_kind: row.mutation_kind ?? null,
  };
}

/**
 * Delete + re-expand intents for every command in the staging DB.
 * Expand runs before delete so a failed LLM call does not wipe existing intents.
 * Per-command failures are logged and skipped (do not abort the round).
 * @param {*} db
 * @param {{ embed: (t: string) => Promise<Float32Array|number[]> }} embedder
 * @param {{
 *   llmJsonObject?: Function,
 *   expandIntents?: Function,
 *   onProgress?: (p: object) => void,
 *   log?: (m: string) => void,
 * }} [opts]
 */
export async function reexpandIntentsForStaging(db, embedder, opts = {}) {
  const rows = listCommands(db);
  const knnForeign = makeKnnForeign(db, knnRecall, INTENT_FOREIGN_KNN_K);
  const log = opts.log || (() => {});
  let done = 0;
  let intentCount = 0;
  let failed = 0;
  for (const row of rows) {
    const commandId = row.row_id;
    const recipe = recipeFromRow(row);
    let intents = [];
    try {
      intents = opts.expandIntents
        ? await opts.expandIntents(recipe, { commandId })
        : await expandIntentsForRecipe(recipe, {
            llmJsonObject: opts.llmJsonObject,
            embedder,
            knnForeign,
            selfCommandId: commandId,
          });
    } catch (e) {
      failed += 1;
      log(
        `improve reexpand skip command=${commandId}: ${e?.message || e}`,
      );
      done += 1;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress({ done, total: rows.length, intentCount, failed });
      }
      continue;
    }

    deleteIntentsForCommand(db, commandId);
    for (const intent of intents || []) {
      const emb = await embedder.embed(intent.intent_text);
      insertIntentWithEmbedding(db, {
        command_id: commandId,
        skill_level: intent.skill_level,
        intent_category: intent.intent_category,
        intent_text: intent.intent_text,
        embedding: emb,
      });
      intentCount += 1;
    }
    done += 1;
    if (typeof opts.onProgress === 'function') {
      opts.onProgress({ done, total: rows.length, intentCount, failed });
    }
  }
  return { commands: rows.length, intents: intentCount, failed };
}
