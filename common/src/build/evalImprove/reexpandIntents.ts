// @ts-nocheck
/**
 * Re-expand intents on staging after lexicon trap updates.
 *
 * Two-phase: (1) expand all recipes in parallel against a fixed DB snapshot
 * for foreign-collision KNN; (2) serial delete+insert so SQLite writes do not
 * race. Failed expands skip that command without wiping existing intents.
 */
import pLimit from 'p-limit';
import {
  listCommands,
  deleteIntentsForCommand,
  insertIntentWithEmbedding,
  knnRecall,
} from '../../db/schema.js';
import {
  INTENT_FOREIGN_KNN_K,
  INTENT_REEXPAND_CONCURRENCY,
} from '../../db/constants.js';
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
 * Expand runs (in parallel) before any delete so a failed LLM call does not
 * wipe existing intents. Per-command expand failures are logged and skipped.
 * @param {*} db
 * @param {{ embed: (t: string) => Promise<Float32Array|number[]> }} embedder
 * @param {{
 *   llmJsonObject?: Function,
 *   expandIntents?: Function,
 *   concurrency?: number,
 *   onProgress?: (p: object) => void,
 *   log?: (m: string) => void,
 * }} [opts]
 */
export async function reexpandIntentsForStaging(db, embedder, opts = {}) {
  const rows = listCommands(db);
  const knnForeign = makeKnnForeign(db, knnRecall, INTENT_FOREIGN_KNN_K);
  const log = opts.log || (() => {});
  const concurrency = Math.max(
    1,
    Math.floor(
      Number(
        opts.concurrency != null
          ? opts.concurrency
          : INTENT_REEXPAND_CONCURRENCY,
      ) || INTENT_REEXPAND_CONCURRENCY,
    ),
  );
  const limit = pLimit(concurrency);
  let expandDone = 0;
  let expandFailed = 0;

  /** @type {Array<{ commandId: number, intents: object[]|null, error?: string }>} */
  const expanded = await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const commandId = row.row_id;
        const recipe = recipeFromRow(row);
        /** @type {{ commandId: number, intents: object[]|null, error?: string }} */
        let result;
        try {
          const intents = opts.expandIntents
            ? await opts.expandIntents(recipe, { commandId })
            : await expandIntentsForRecipe(recipe, {
                llmJsonObject: opts.llmJsonObject,
                embedder,
                knnForeign,
                selfCommandId: commandId,
              });
          result = { commandId, intents: intents || [] };
        } catch (e) {
          log(
            `improve reexpand skip command=${commandId}: ${e?.message || e}`,
          );
          result = {
            commandId,
            intents: null,
            error: String(e?.message || e),
          };
        }
        expandDone += 1;
        if (result.intents == null) expandFailed += 1;
        if (typeof opts.onProgress === 'function') {
          opts.onProgress({
            done: expandDone,
            total: rows.length,
            intentCount: 0,
            failed: expandFailed,
            phase: 'expand',
          });
        }
        return result;
      }),
    ),
  );

  let done = 0;
  let intentCount = 0;
  let failed = expandFailed;
  for (const item of expanded) {
    if (item.intents == null) {
      done += 1;
      if (typeof opts.onProgress === 'function') {
        opts.onProgress({
          done,
          total: rows.length,
          intentCount,
          failed,
          phase: 'write',
        });
      }
      continue;
    }

    deleteIntentsForCommand(db, item.commandId);
    for (const intent of item.intents) {
      const emb = await embedder.embed(intent.intent_text);
      insertIntentWithEmbedding(db, {
        command_id: item.commandId,
        skill_level: intent.skill_level,
        intent_category: intent.intent_category,
        intent_text: intent.intent_text,
        embedding: emb,
      });
      intentCount += 1;
    }
    done += 1;
    if (typeof opts.onProgress === 'function') {
      opts.onProgress({
        done,
        total: rows.length,
        intentCount,
        failed,
        phase: 'write',
      });
    }
  }

  return {
    commands: rows.length,
    intents: intentCount,
    failed,
    concurrency,
  };
}
