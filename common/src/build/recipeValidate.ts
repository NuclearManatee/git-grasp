// @ts-nocheck
/**
 * Ordered recipe validation: plausibility → sandbox → meaningfulness → back-translation.
 */
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import {
  PlausibilityLlmSchema,
  MeaningfulnessJudgeLlmSchema,
  BackTranslateLlmSchema,
} from '../schemas/recipe.js';
import { assertRecipeFlagsAllowed } from './recipeFlags.js';
import { validateInSandboxAndDestroy } from './sandbox.js';
import { commandFingerprint } from '../db/schema.js';
import { parseCommands, renderSnippet } from '../db/recipeFormat.js';
import { VALIDATION_MAX_REGEN } from '../db/constants.js';

/**
 * Cheap structural plausibility before LLM/sandbox.
 */
export function cheapPlausibilityCheck(candidate) {
  const commands = parseCommands(candidate?.commands);
  if (!commands.length) return { ok: false, reason: 'commands_empty' };
  for (const step of commands) {
    const run = String(step.command || '').trim();
    if (!run) return { ok: false, reason: 'empty_step' };
    if (/[;&|`]/.test(run) || run.includes('&&') || run.includes('||')) {
      return { ok: false, reason: 'shell_meta', run };
    }
    if (!/^git(\s|$)/i.test(run) && !/^(gitk|scalar)\b/i.test(run)) {
      return { ok: false, reason: 'not_git', run };
    }
  }
  const initial = String(candidate?.initial_state || '');
  const fixture = candidate?.fixture;
  if (fixture) {
    // Fixture path — no freeform initial_state script allowed beyond fixture: label.
    if (initial.trim() && !/^fixture:[a-z_]+$/.test(initial.trim())) {
      return { ok: false, reason: 'initial_state_with_fixture' };
    }
  } else if (initial.trim()) {
    if (/[;&|`]/.test(initial) || initial.includes('&&') || initial.includes('||')) {
      return { ok: false, reason: 'initial_state_shell_meta' };
    }
  }
  if (!String(candidate?.title || '').trim()) {
    return { ok: false, reason: 'missing_title' };
  }
  if (!String(candidate?.description || '').trim()) {
    return { ok: false, reason: 'missing_description' };
  }
  return { ok: true };
}

export async function llmPlausibility(candidate, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { messages } = renderPrompt('build/plausibility', {
    title: candidate.title,
    description: candidate.description,
    commands: renderSnippet(candidate.commands),
  });
  return call({ schema: PlausibilityLlmSchema, messages });
}

export async function llmMeaningfulness(candidate, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { messages } = renderPrompt('build/meaningfulness-judge', {
    title: candidate.title,
    description: candidate.description,
    commands: renderSnippet(candidate.commands),
  });
  return call({ schema: MeaningfulnessJudgeLlmSchema, messages });
}

export async function llmBackTranslate(candidate, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { messages } = renderPrompt('build/back-translate', {
    title: candidate.title,
    commands: renderSnippet(candidate.commands),
    original_description: candidate.description,
  });
  return call({ schema: BackTranslateLlmSchema, messages });
}

/**
 * Full validation chain for one candidate.
 * @returns {{ ok: boolean, reason?: string, recipe?: object, stage?: string }}
 */
export async function validateRecipeCandidate(candidate, opts = {}) {
  const maxRegen = opts.maxRegen ?? VALIDATION_MAX_REGEN;
  let current = { ...candidate };
  let lastReason = 'unknown';

  for (let attempt = 0; attempt <= maxRegen; attempt += 1) {
    const cheap = cheapPlausibilityCheck(current);
    if (!cheap.ok) {
      lastReason = cheap.reason;
      if (attempt === maxRegen || !opts.regen) break;
      current = await opts.regen(current, cheap.reason);
      continue;
    }

    if (opts.skipLlmPlausibility !== true) {
      const plaus = await llmPlausibility(current, opts);
      if (!plaus.ok) {
        lastReason = plaus.reason || 'plausibility';
        if (attempt === maxRegen || !opts.regen) {
          return { ok: false, reason: lastReason, stage: 'plausibility' };
        }
        current = await opts.regen(current, lastReason);
        continue;
      }
    }

    const flagCheck = assertRecipeFlagsAllowed(
      { command_recipe: { commands: parseCommands(current.commands) } },
      opts,
    );
    if (flagCheck && flagCheck.ok === false) {
      lastReason = flagCheck.reason || 'flags';
      if (attempt === maxRegen || !opts.regen) {
        return { ok: false, reason: lastReason, stage: 'flags' };
      }
      current = await opts.regen(current, lastReason);
      continue;
    }

    let sand;
    if (opts.sandboxResult) {
      sand = opts.sandboxResult;
    } else if (opts.skipSandbox) {
      sand = {
        ok: true,
        initial_state_physical_hash: 'skip',
        final_state_physical_hash: 'skip',
      };
    } else {
      sand = await validateInSandboxAndDestroy({
        fixture: current.fixture,
        initial_state: current.initial_state || '',
        command_recipe: { commands: parseCommands(current.commands) },
      });
    }
    if (!sand?.ok) {
      lastReason = sand?.reason || 'sandbox';
      if (attempt === maxRegen || !opts.regen) {
        return { ok: false, reason: lastReason, stage: 'sandbox' };
      }
      current = await opts.regen(current, lastReason);
      continue;
    }

    if (opts.skipJudge !== true) {
      const judge = await llmMeaningfulness(current, opts);
      const minScore = opts.minJudgeScore ?? 0.6;
      // Reject unless pass AND score meets floor (OR-inverted was accepting fail+high-score).
      if (!judge.pass || (judge.score ?? 0) < minScore) {
        lastReason = judge.reason || 'meaningfulness';
        if (attempt === maxRegen || !opts.regen) {
          return { ok: false, reason: lastReason, stage: 'judge' };
        }
        current = await opts.regen(current, lastReason);
        continue;
      }
    }

    if (opts.skipBackTranslate !== true) {
      const back = await llmBackTranslate(current, opts);
      if (!back.aligned) {
        lastReason = back.reason || 'back_translation';
        if (attempt === maxRegen || !opts.regen) {
          return { ok: false, reason: lastReason, stage: 'back_translation' };
        }
        current = await opts.regen(current, lastReason);
        continue;
      }
    }

    const fp = commandFingerprint(current.commands);
    return {
      ok: true,
      stage: 'accept',
      recipe: {
        ...current,
        validated: true,
        command_fingerprint: fp,
        initial_state_physical_hash: sand.initial_state_physical_hash || '',
        final_state_physical_hash: sand.final_state_physical_hash || '',
        provenance: current.provenance || 'synthetic',
      },
    };
  }

  return { ok: false, reason: lastReason, stage: 'exhausted' };
}
