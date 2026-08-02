// @ts-nocheck
/**
 * Deterministic miss classification for eval gate recovery.
 */
import { verbFromCommandLine } from '../coverage.js';
import { verbsInFamily, buildVerbFamilyIndex } from '../evalImprove/verbFamilies.js';

export const MISS_CLASSES = /** @type {const} */ ([
  'partial_multistep',
  'over_ask',
  'retrieval_sibling',
  'destructive_alt',
  'other',
]);

const DESTRUCTIVE_DISPLAY = new Set(['git reset', 'git clean']);
const REVERT_LIKE = new Set(['git revert']);

function normVerb(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function displayedPrimaryVerb(row) {
  const displayed = row?.displayed || [];
  if (!displayed.length) return null;
  const hit = displayed[0];
  const text = [hit.example, hit.snippet, hit.command].filter(Boolean).join('\n');
  for (const line of String(text).split(/\n/)) {
    const m = line.match(/\bgit\s+[a-z0-9][-a-z0-9]*/i);
    if (m) return verbFromCommandLine(m[0]);
  }
  return null;
}

function queryGitVerbs(queryText) {
  const found = [];
  const re = /\bgit\s+[a-z0-9][-a-z0-9]*/gi;
  let m;
  const text = String(queryText || '');
  while ((m = re.exec(text))) {
    const v = verbFromCommandLine(m[0]);
    if (v) found.push(normVerb(v));
  }
  return [...new Set(found)];
}

function hasMultiActionCue(queryText) {
  const q = String(queryText || '').toLowerCase();
  if (/\band\b/.test(q) || /\bthen\b/.test(q)) return true;
  if (/\blist\b.+\bdelete\b/.test(q) || /\bcreate\b.+\bbranch\b/.test(q)) return true;
  return queryGitVerbs(q).length >= 2;
}

/**
 * @param {object} row eval result row
 * @param {{ familyIndex?: Map<string, Set<string>> }} [opts]
 * @returns {typeof MISS_CLASSES[number]}
 */
export function classifyMiss(row, opts = {}) {
  if (!row || row.pass === true) return 'other';
  const familyIndex = opts.familyIndex || buildVerbFamilyIndex();
  const expected = normVerb(row.query?.primary_verb);
  const displayedVerb = normVerb(displayedPrimaryVerb(row));
  const queryText = row.query?.query_text || '';
  const mutation = row.query?.mutation_kind || null;
  const emptyDisplay = !(row.displayed && row.displayed.length);

  if (emptyDisplay) return 'retrieval_sibling';

  if (
    expected &&
    REVERT_LIKE.has(expected) &&
    displayedVerb &&
    DESTRUCTIVE_DISPLAY.has(displayedVerb)
  ) {
    return 'destructive_alt';
  }

  const family = expected ? verbsInFamily(expected, familyIndex) : new Set();
  const displayInFamily =
    displayedVerb &&
    (family.has(displayedVerb) || (expected && displayedVerb === expected));

  if (displayedVerb && expected && !displayInFamily) {
    return 'retrieval_sibling';
  }

  const multi = hasMultiActionCue(queryText);
  if (multi && displayInFamily) {
    if (mutation === 'composition' || mutation === 'flag') return 'over_ask';
    return 'partial_multistep';
  }

  if (displayInFamily && (row.via === 'ko' || row.via === 'miss')) {
    const util = row.utility ?? row.judge?.utility;
    if (typeof util === 'number' && util < 0.9) {
      return multi ? 'partial_multistep' : 'partial_multistep';
    }
    if (multi) return 'partial_multistep';
  }

  if (multi && (mutation === 'composition' || mutation === 'flag')) {
    return 'over_ask';
  }

  return 'other';
}

/**
 * @param {object[]} results
 * @param {{ familyIndex?: Map<string, Set<string>> }} [opts]
 */
export function classifyEvalMisses(results, opts = {}) {
  const familyIndex = opts.familyIndex || buildVerbFamilyIndex();
  const out = [];
  for (const row of results || []) {
    if (!row || row.pass === true || row.via === 'skipped') continue;
    const cls = classifyMiss(row, { familyIndex });
    out.push({
      class: cls,
      row,
      command_id: Number(row.query?.command_id) || null,
      query_text: row.query?.query_text || '',
      primary_verb: row.query?.primary_verb || null,
    });
  }
  return out;
}

export function partitionByClass(classified) {
  /** @type {Record<string, object[]>} */
  const map = {
    partial_multistep: [],
    over_ask: [],
    retrieval_sibling: [],
    destructive_alt: [],
    other: [],
  };
  for (const c of classified || []) {
    (map[c.class] || map.other).push(c);
  }
  return map;
}

export function needsBankRewrite(classified) {
  return (classified || []).some((c) =>
    ['partial_multistep', 'over_ask', 'destructive_alt'].includes(c.class),
  );
}

export function needsImproveRound(classified) {
  return (classified || []).some((c) => c.class === 'retrieval_sibling');
}
