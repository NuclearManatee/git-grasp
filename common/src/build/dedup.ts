// @ts-nocheck
/**
 * Dedup by physical hash pair + normalized recipe fingerprint; keep simpler.
 */
import { parseCommands, serializeCommandRecipe } from '../db/recipeFormat.js';
import { verbFromCommandLine } from './coverage.js';

const FLAG_RE = /^--?[A-Za-z]/;

export function countFlags(recipe) {
  const steps = parseCommands(recipe);
  let n = 0;
  for (const s of steps) {
    for (const tok of s.command.split(/\s+/)) {
      if (FLAG_RE.test(tok)) n += 1;
    }
  }
  return n;
}

export function countArgvTokens(recipe) {
  const steps = parseCommands(recipe);
  return steps.reduce((acc, s) => acc + s.command.split(/\s+/).filter(Boolean).length, 0);
}

export function simplicityKey(recipe) {
  const steps = parseCommands(recipe);
  return [
    steps.length,
    countFlags(recipe),
    countArgvTokens(recipe),
    serializeCommandRecipe(recipe),
  ];
}

/**
 * Normalized fingerprint: verbs + sorted flags (drop volatile path-like tokens).
 */
export function recipeFingerprint(recipe) {
  const steps = parseCommands(recipe);
  const parts = [];
  for (const s of steps) {
    const toks = String(s.command || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const verb = verbFromCommandLine(s.command) || toks.slice(0, 2).join(' ');
    const flags = toks
      .filter((t) => FLAG_RE.test(t))
      .map((t) => t.toLowerCase())
      .sort();
    parts.push(`${verb}|${flags.join(',')}`);
  }
  return parts.join('||');
}

/**
 * @returns {number} negative if a simpler than b, positive if a more complex, 0 equal
 */
export function compareSimplicity(recipeA, recipeB) {
  const a = simplicityKey(recipeA);
  const b = simplicityKey(recipeB);
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return 0;
}

/**
 * @param {object|null} existing DB row or null
 * @param {{ command_recipe: object }} candidate
 * @returns {'insert'|'keep_existing'|'replace_existing'}
 */
export function dedupDecision(existing, candidate) {
  if (!existing) return 'insert';
  const cmp = compareSimplicity(candidate.command_recipe, existing.command_recipe);
  if (cmp < 0) return 'replace_existing';
  return 'keep_existing';
}

/**
 * Find an existing command with the same recipe fingerprint (secondary key).
 * @param {object} db openDb handle
 * @param {string} fingerprint
 * @param {{ listCommands?: Function }} [opts]
 */
export function findCommandByFingerprint(db, fingerprint, opts = {}) {
  if (!fingerprint) return null;
  const list =
    opts.listCommands ||
    ((d) => {
      const raw = d._db ?? d;
      return raw.prepare('SELECT row_id, command_recipe, initial_state, risk, parent_row_id, mutation_kind FROM commands').all();
    });
  for (const row of list(db)) {
    if (recipeFingerprint(row.command_recipe) === fingerprint) return row;
  }
  return null;
}
