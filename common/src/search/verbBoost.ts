// @ts-nocheck
/**
 * Soft verb boosts for hybrid ranking when the query names git verbs.
 */
import { verbFromCommandLine } from '../build/coverage.js';
import {
  PRIMARY_VERB_BOOST,
  VERB_COVERAGE_BOOST_PER,
} from '../db/constants.js';

export { PRIMARY_VERB_BOOST, VERB_COVERAGE_BOOST_PER };

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
 * All verb tokens from a multi-step hit.
 * @param {{ commands?: { command?: string }[], example?: string, snippet?: string }} hit
 * @returns {string[]}
 */
export function recipeVerbTokensFromHit(hit) {
  const tokens = [];
  const steps = hit?.commands || [];
  if (steps.length) {
    for (const s of steps) {
      const verb = verbFromCommandLine(s?.command || '');
      if (verb) tokens.push(verb.replace(/^git\s+/i, '').toLowerCase());
    }
  } else {
    const text = [hit?.example, hit?.snippet].filter(Boolean).join('\n');
    for (const line of String(text).split(/\n/)) {
      const m = line.match(/\bgit\s+[a-z0-9][-a-z0-9]*/i);
      if (!m) continue;
      const verb = verbFromCommandLine(m[0]);
      if (verb) tokens.push(verb.replace(/^git\s+/i, '').toLowerCase());
    }
  }
  return [...new Set(tokens)];
}

/**
 * Git verb tokens named in the query (via known verbs list or `git X` phrases).
 * @param {string} query
 * @param {readonly string[]} [knownVerbs]
 * @returns {string[]}
 */
export function queryNamedVerbTokens(query, knownVerbs = []) {
  const tokens = new Set(queryTokens(query));
  const named = new Set();
  const q = String(query || '').toLowerCase();
  const re = /\bgit\s+[a-z0-9][-a-z0-9]*/gi;
  let m;
  while ((m = re.exec(q))) {
    const verb = verbFromCommandLine(m[0]);
    if (verb) named.add(verb.replace(/^git\s+/i, '').toLowerCase());
  }
  for (const v of knownVerbs || []) {
    const t = String(v || '')
      .replace(/^git\s+/i, '')
      .toLowerCase();
    if (!t) continue;
    if (tokens.has(t)) named.add(t);
    if (t.includes('-') && tokens.has(t.replace(/-/g, ''))) named.add(t);
  }
  return [...named];
}

/**
 * True if query tokens include the hit's primary verb token.
 * @param {string} query
 * @param {string} primaryToken
 * @param {readonly string[]} [knownVerbs]
 */
export function queryNamesPrimaryVerb(query, primaryToken, knownVerbs = []) {
  const token = String(primaryToken || '')
    .replace(/^git\s+/i, '')
    .toLowerCase();
  if (!token) return false;
  return queryNamedVerbTokens(query, knownVerbs).includes(token) ||
    queryTokens(query).includes(token);
}

/**
 * Apply primary-verb boost + multi-verb coverage boost (capped at 1).
 * @param {Array<{ score: number, example?: string, commands?: object[], command?: string, snippet?: string }>} scored
 * @param {string} query
 * @param {readonly string[]} [knownVerbs]
 */
export function applyPrimaryVerbBoost(scored, query, knownVerbs = []) {
  const named = queryNamedVerbTokens(query, knownVerbs);
  return (scored || []).map((hit) => {
    const primary = primaryVerbTokenFromHit(hit);
    const recipeVerbs = recipeVerbTokensFromHit(hit);
    let boost = 0;
    if (primary && (named.includes(primary) || queryNamesPrimaryVerb(query, primary, knownVerbs))) {
      boost += PRIMARY_VERB_BOOST;
    }
    if (named.length >= 2 && recipeVerbs.length >= 2) {
      const covered = named.filter((v) => recipeVerbs.includes(v)).length;
      // Extra for verbs beyond the first covered (primary already boosted).
      const extra = Math.max(0, covered - 1);
      boost += extra * VERB_COVERAGE_BOOST_PER;
    }
    if (boost <= 0) {
      return { ...hit, score_verb_boost: 0, score_coverage_boost: 0 };
    }
    const base = Number(hit.score) || 0;
    const primaryPart = Math.min(boost, PRIMARY_VERB_BOOST);
    const coveragePart = Math.max(0, boost - PRIMARY_VERB_BOOST);
    const boosted = Math.min(1, base + boost);
    return {
      ...hit,
      score: boosted,
      score_hybrid: boosted,
      score_verb_boost: primaryPart,
      score_coverage_boost: coveragePart,
    };
  });
}
