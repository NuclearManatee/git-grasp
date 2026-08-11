// @ts-nocheck
/**
 * Snippet hygiene: rewrite sandbox-isms into idiomatic user-facing recipes.
 * Eval-recovery / polish path only — not used on the product leaf GENERATE accept path.
 * Never blocks the build — on any failure, returns the original recipe.
 */
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import { RecipeBodyLlmResponseSchema } from '../schemas/command.js';
import { parseCommands } from '../db/recipeFormat.js';
import { recipeFingerprint } from './dedup.js';
import { validateInSandboxAndDestroy } from './sandbox.js';
import { assertRecipeFlagsAllowed } from './recipeFlags.js';

/**
 * @param {object} recipe validated recipe (initial_state, command_recipe, risk, hashes…)
 * @param {{
 *   llmJsonObject?: Function,
 *   validate?: Function,
 *   skipSandbox?: boolean,
 *   log?: (m: string) => void,
 * }} [opts]
 * @returns {Promise<object>} polished recipe or original
 */
export async function polishRecipeHygiene(recipe, opts = {}) {
  const log = opts.log || (() => {});
  if (!recipe?.command_recipe || !recipe?.initial_state) return recipe;
  const beforeFp = recipeFingerprint(recipe.command_recipe);
  const beforeSteps = parseCommands(recipe.command_recipe).length;

  let polished;
  try {
    const call = opts.llmJsonObject || llmJsonObject;
    const { messages } = renderPrompt('build/polish-recipe', {
      recipe_json: JSON.stringify(
        {
          initial_state: recipe.initial_state,
          command_recipe: recipe.command_recipe,
          risk: recipe.risk,
        },
        null,
        2,
      ),
      notes:
        'Prefer realistic file names and comments. Do not change verbs or flags.',
    });
    polished = await call({
      schema: RecipeBodyLlmResponseSchema,
      messages,
    });
  } catch (e) {
    log(`polish-recipe LLM failed: ${e?.message || e}`);
    return recipe;
  }

  const afterSteps = parseCommands(polished.command_recipe).length;
  if (afterSteps !== beforeSteps) {
    log(`polish-recipe reject: step count ${beforeSteps}->${afterSteps}`);
    return recipe;
  }
  const afterFp = recipeFingerprint(polished.command_recipe);
  if (afterFp !== beforeFp) {
    log(`polish-recipe reject: fingerprint changed`);
    return recipe;
  }

  const flagGate = assertRecipeFlagsAllowed(polished, {
    fetchHelp: opts.fetchHelp,
  });
  if (!flagGate.ok) {
    log(`polish-recipe reject: flags ${flagGate.reason}`);
    return recipe;
  }

  if (opts.skipSandbox) {
    return {
      ...recipe,
      initial_state: polished.initial_state,
      command_recipe: polished.command_recipe,
      risk: polished.risk ?? recipe.risk,
    };
  }

  try {
    const result = opts.validate
      ? await opts.validate(polished)
      : validateInSandboxAndDestroy({
          ...polished,
          workerId: opts.workerId ?? 0,
          jobId: opts.jobId || 'polish-recipe',
        });
    if (!result.ok) {
      log(`polish-recipe reject: sandbox ${result.reason}`);
      return recipe;
    }
    return {
      ...recipe,
      initial_state: polished.initial_state,
      command_recipe: polished.command_recipe,
      risk: polished.risk ?? recipe.risk,
      initial_state_physical_hash: result.initial_state_physical_hash,
      final_state_physical_hash: result.final_state_physical_hash,
      polished: true,
    };
  } catch (e) {
    log(`polish-recipe sandbox error: ${e?.message || e}`);
    return recipe;
  }
}
