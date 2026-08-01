// @ts-nocheck
/**
 * Post-condition guards for multi-axis evolve mutations.
 */
import { parseCommands } from '../db/recipeFormat.js';
import { LOOP_MAX_RECIPE_STEPS, LOOP_MAX_FLAGS_PER_STEP } from '../db/constants.js';
import {
  sameStepVerbs,
  flagsAllowedOnCommand,
  flagsFromCommandLine,
  verbFromCommandLine,
  stepVerbs,
} from './coverage.js';
import { fetchGitShortHelp } from './gitShortHelp.js';
import { assertRecipeFlagsAllowed, FLAG_DENYLIST } from './recipeFlags.js';
import { countFlags } from './dedup.js';

const META = /&&|\|\||[|;`$]/;

/** Contradictory flag pairs (normalized). */
export const CONTRADICTORY_FLAG_PAIRS = [
  ['--find-renames', '--no-renames'],
];

export const SECONDARY_FILLER_VERBS = new Set(['git status', 'git log', 'git diff']);

/**
 * @param {string} commandLine
 */
export function hasShellMetacharacters(commandLine) {
  return META.test(String(commandLine || ''));
}

function flagCountOnLine(commandLine) {
  return String(commandLine || '')
    .split(/\s+/)
    .filter((t) => t.startsWith('-') && t !== '--').length;
}

function hasContradictoryFlags(commandLine) {
  const flags = new Set(
    String(commandLine || '')
      .split(/\s+/)
      .filter((t) => t.startsWith('-'))
      .map((t) => t.toLowerCase()),
  );
  for (const [a, b] of CONTRADICTORY_FLAG_PAIRS) {
    if (flags.has(a) && flags.has(b)) return `${a}+${b}`;
  }
  return null;
}

/**
 * @param {object} parent
 * @param {object} child
 */
export function assertStateMutation(parent, child) {
  if (!sameStepVerbs(parent, child)) {
    return { ok: false, reason: 'state_mutation_changed_verbs' };
  }
  if (String(child.initial_state || '').trim() === String(parent.initial_state || '').trim()) {
    return { ok: false, reason: 'state_mutation_unchanged_initial_state' };
  }
  for (const s of parseCommands(child.command_recipe)) {
    if (hasShellMetacharacters(s.command)) {
      return { ok: false, reason: 'shell_metacharacters' };
    }
  }
  return { ok: true };
}

/**
 * @param {object} parent
 * @param {object} child
 * @param {Record<string, Set<string>|string[]>} [allowlistsByVerb]
 */
export function assertFlagMutation(parent, child, allowlistsByVerb = {}) {
  if (!sameStepVerbs(parent, child)) {
    return { ok: false, reason: 'flag_mutation_changed_verbs' };
  }
  const parentSteps = parseCommands(parent.command_recipe);
  const steps = parseCommands(child.command_recipe);
  let totalFlagDelta = 0;

  for (let i = 0; i < steps.length; i += 1) {
    const s = steps[i];
    if (hasShellMetacharacters(s.command)) {
      return { ok: false, reason: 'shell_metacharacters' };
    }
    const nFlags = flagCountOnLine(s.command);
    if (nFlags > LOOP_MAX_FLAGS_PER_STEP) {
      return { ok: false, reason: `too_many_flags_step:${nFlags}` };
    }
    const contra = hasContradictoryFlags(s.command);
    if (contra) {
      return { ok: false, reason: `contradictory_flags:${contra}` };
    }
    for (const f of flagsFromCommandLine(s.command)) {
      if (FLAG_DENYLIST.has(f) || FLAG_DENYLIST.has(f.toLowerCase())) {
        return { ok: false, reason: `flag_denied:${f}` };
      }
    }
    const verb = verbFromCommandLine(s.command);
    const allow = allowlistsByVerb[verb];
    if (!allow || (Array.isArray(allow) ? allow.length === 0 : allow.size === 0)) {
      return { ok: false, reason: `flag_allowlist_empty:${verb}` };
    }
    if (!flagsAllowedOnCommand(s.command, allow)) {
      return { ok: false, reason: `flag_not_in_allowlist:${verb}` };
    }
    const parentFlags = flagCountOnLine(parentSteps[i]?.command || '');
    totalFlagDelta += Math.max(0, nFlags - parentFlags);
  }

  if (totalFlagDelta > 1) {
    return { ok: false, reason: `flag_delta_too_large:${totalFlagDelta}` };
  }
  if (totalFlagDelta < 1 && countFlags(child.command_recipe) <= countFlags(parent.command_recipe)) {
    return { ok: false, reason: 'flag_mutation_no_new_flag' };
  }
  return { ok: true };
}

/**
 * @param {object} parent
 * @param {object} child
 * @param {{ insert_index?: number, fetchHelp?: typeof fetchGitShortHelp }} [opts]
 */
export function assertCompositionMutation(parent, child, opts = {}) {
  const parentSteps = parseCommands(parent.command_recipe);
  const childSteps = parseCommands(child.command_recipe);
  if (childSteps.length < 1 || childSteps.length > LOOP_MAX_RECIPE_STEPS) {
    return { ok: false, reason: 'composition_step_count' };
  }
  if (parentSteps.length >= LOOP_MAX_RECIPE_STEPS) {
    return { ok: false, reason: 'composition_parent_full' };
  }
  const sameLen = parentSteps.length === childSteps.length;
  const sameVerbs =
    sameLen &&
    stepVerbs(parent).every((v, i) => v === stepVerbs(child)[i]);
  if (sameVerbs) {
    return { ok: false, reason: 'composition_no_insert' };
  }
  if (childSteps.length > parentSteps.length + 1) {
    return { ok: false, reason: 'composition_inserted_too_many' };
  }
  const fetchHelp = opts.fetchHelp || fetchGitShortHelp;
  const parentPrimary = verbFromCommandLine(parentSteps[0]?.command || '');
  for (const s of childSteps) {
    if (!s.command.startsWith('git ')) {
      return { ok: false, reason: 'composition_non_git' };
    }
    if (hasShellMetacharacters(s.command)) {
      return { ok: false, reason: 'shell_metacharacters' };
    }
    const verb = verbFromCommandLine(s.command);
    if (
      SECONDARY_FILLER_VERBS.has(verb) &&
      verb !== parentPrimary &&
      !parentSteps.some((p) => verbFromCommandLine(p.command) === verb)
    ) {
      return { ok: false, reason: `composition_filler:${verb}` };
    }
    const help = fetchHelp(verb);
    if (!help.ok && !help.text) {
      return { ok: false, reason: `composition_no_help:${verb}` };
    }
  }
  const flagGate = assertRecipeFlagsAllowed(child, { fetchHelp });
  if (!flagGate.ok) {
    return flagGate;
  }
  const idx = opts.insert_index;
  if (idx != null && (idx < 0 || idx > parentSteps.length)) {
    return { ok: false, reason: 'composition_bad_insert_index' };
  }
  return { ok: true };
}

/**
 * @param {'state'|'flag'|'composition'} kind
 * @param {object} parent
 * @param {object} child
 * @param {object} [opts]
 */
export function assertEvolveMutation(kind, parent, child, opts = {}) {
  if (kind === 'state') return assertStateMutation(parent, child);
  if (kind === 'flag') return assertFlagMutation(parent, child, opts.allowlistsByVerb);
  if (kind === 'composition') return assertCompositionMutation(parent, child, opts);
  return { ok: false, reason: 'unknown_mutation_kind' };
}
