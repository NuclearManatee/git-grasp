// @ts-nocheck
/**
 * Soft primary-verb boost for hybrid ranking when the query names the verb.
 */
import { verbFromCommandLine } from '../build/coverage.js';

/** Additive hybrid score bump when query token matches hit primary verb. */
export const PRIMARY_VERB_BOOST = 0.25;

/**
 * Tokenize query into lowercase words (alphanumeric + hyphen).
 * @param {string} query
 */
export function queryTokens(query) {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_+-]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Primary verb token from a hit (`git diff` → `diff`).
 * @param {{ example?: string, commands?: { command?: string }[], command?: string }} hit
 */
export function primaryVerbTokenFromHit(hit) {
  const line =
    hit?.example ||
    hit?.commands?.[0]?.command ||
    hit?.command ||
    '';
  const verb = verbFromCommandLine(line);
  if (!verb) return '';
  return verb.replace(/^git\s+/i, '').toLowerCase();
}

/**
 * True if query tokens include the hit's primary verb token.
 * Prefer exact token match; also accept when known taxonomy verbs list is provided.
 * @param {string} query
 * @param {string} primaryToken
 * @param {readonly string[]} [knownVerbs] e.g. `diff`, `status` or `git diff`
 */
export function queryNamesPrimaryVerb(query, primaryToken, knownVerbs = []) {
  const token = String(primaryToken || '')
    .replace(/^git\s+/i, '')
    .toLowerCase();
  if (!token) return false;
  const tokens = new Set(queryTokens(query));
  if (tokens.has(token)) return true;
  // Multi-word verbs like cherry-pick
  if (token.includes('-') && tokens.has(token.replace(/-/g, ''))) return true;
  for (const v of knownVerbs || []) {
    const t = String(v || '')
      .replace(/^git\s+/i, '')
      .toLowerCase();
    if (t === token && tokens.has(t)) return true;
  }
  return false;
}

/**
 * Apply +PRIMARY_VERB_BOOST (capped at 1) when query names the hit primary verb.
 * Mutates/returns new array sorted by caller.
 * @param {Array<{ score: number, example?: string, commands?: object[], command?: string }>} scored
 * @param {string} query
 * @param {readonly string[]} [knownVerbs]
 */
export function applyPrimaryVerbBoost(scored, query, knownVerbs = []) {
  return (scored || []).map((hit) => {
    const token = primaryVerbTokenFromHit(hit);
    if (!queryNamesPrimaryVerb(query, token, knownVerbs)) {
      return { ...hit, score_verb_boost: 0 };
    }
    const base = Number(hit.score) || 0;
    const boosted = Math.min(1, base + PRIMARY_VERB_BOOST);
    return {
      ...hit,
      score: boosted,
      score_hybrid: boosted,
      score_verb_boost: PRIMARY_VERB_BOOST,
    };
  });
}
