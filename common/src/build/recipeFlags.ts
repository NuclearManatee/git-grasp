// @ts-nocheck
/**
 * Fail-closed flag allowlist checks for ground / composition recipes.
 */
import { parseCommands } from '../db/recipeFormat.js';
import {
  flagsFromCommandLine,
  parseFlagsFromHelp,
  verbFromCommandLine,
} from './coverage.js';
import { fetchGitShortHelp } from './gitShortHelp.js';

/** Known junk flags Git may accept but we never want in the catalog. */
export const FLAG_DENYLIST = new Set(['--i-still-use-this']);

/**
 * @param {string} commandLine
 * @param {Set<string>|string[]|null|undefined} allowlist
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function assertFlagsOnCommandLine(commandLine, allowlist) {
  const used = flagsFromCommandLine(commandLine);
  for (const f of used) {
    if (FLAG_DENYLIST.has(f) || FLAG_DENYLIST.has(f.toLowerCase())) {
      return { ok: false, reason: `flag_denied:${f}` };
    }
  }
  if (!used.length) return { ok: true };

  const allow = allowlist instanceof Set ? allowlist : new Set(allowlist || []);
  if (!allow.size) {
    return { ok: false, reason: 'flags_allowlist_empty' };
  }
  for (const f of used) {
    if (!allow.has(f) && !allow.has(f.toLowerCase())) {
      return { ok: false, reason: `flag_not_in_allowlist:${f}` };
    }
  }
  return { ok: true };
}

/**
 * Build allowlist for a verb from live `git <verb> -h`.
 * @param {string} verb e.g. `git status`
 * @param {{ fetchHelp?: typeof fetchGitShortHelp }} [opts]
 */
export function allowlistForVerb(verb, opts = {}) {
  const fetchHelp = opts.fetchHelp || fetchGitShortHelp;
  const help = fetchHelp(verb);
  return parseFlagsFromHelp(help.text || '');
}

/**
 * Fail-closed: every recipe step's flags must be on git -h allowlist (or bare).
 * @param {object} recipe `{ command_recipe }` or raw recipe
 * @param {{ fetchHelp?: typeof fetchGitShortHelp, allowlistsByVerb?: Record<string, Set<string>> }} [opts]
 */
export function assertRecipeFlagsAllowed(recipe, opts = {}) {
  const steps = parseCommands(recipe?.command_recipe ?? recipe);
  for (const s of steps) {
    const verb = verbFromCommandLine(s.command);
    if (!verb) {
      // Standalone tools (gitk, …): no git flags expected.
      continue;
    }
    const allow =
      opts.allowlistsByVerb?.[verb] ??
      allowlistForVerb(verb, { fetchHelp: opts.fetchHelp });
    const check = assertFlagsOnCommandLine(s.command, allow);
    if (!check.ok) {
      return { ok: false, reason: `${check.reason}:${verb}` };
    }
  }
  return { ok: true };
}
