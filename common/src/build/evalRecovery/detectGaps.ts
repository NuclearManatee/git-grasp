// @ts-nocheck
/**
 * Judge-based coverage gap detection for goal-shaped (no-verb) eval misses.
 */
import { z } from 'zod';
import { EVAL_GAP_CHECK_MAX, EVAL_GAP_CHECK_TOP_K } from '../../db/constants.js';
import { llmJsonObject } from '../../lib/llm.js';
import { renderPrompt } from '../../lib/prompts.js';
import { queryGitVerbs } from './coverageHelpers.js';

const GapCheckSchema = z.object({
  match_command_id: z.union([z.number(), z.null()]),
});

/**
 * Candidates from a searchFn result (prefer full `results`, else display).
 * @param {*} searchOut
 * @param {number} topK
 */
export function candidatesFromSearchOutput(searchOut, topK = EVAL_GAP_CHECK_TOP_K) {
  let hits = [];
  if (Array.isArray(searchOut)) {
    hits = searchOut;
  } else if (Array.isArray(searchOut?.results) && searchOut.results.length) {
    hits = searchOut.results;
  } else if (Array.isArray(searchOut?.displayResults)) {
    hits = searchOut.displayResults;
  }
  return hits.slice(0, topK).map((h) => ({
    command_id: Number(h.command_id ?? h.recipe_id),
    title: h.title || h.example || '',
    example: h.example || '',
    snippet: h.snippet || h.command || '',
  }));
}

/**
 * Reclassify retrieval_sibling / other misses that lack ≥2 git verbs in the query.
 * - match in top-K → keep/force retrieval_sibling (recipe exists)
 * - no match → coverage_gap (goal-shaped gap)
 *
 * @param {object[]} classified from classifyEvalMisses
 * @param {{
 *   searchFn?: (q: string, opts?: object) => Promise<*>,
 *   llmJsonObject?: Function,
 *   maxChecks?: number,
 *   topK?: number,
 *   log?: (m: string) => void,
 * }} [opts]
 * @returns {Promise<{ classified: object[], checks: object[] }>}
 */
export async function detectGaps(classified, opts = {}) {
  const log = opts.log || (() => {});
  const call = opts.llmJsonObject || llmJsonObject;
  const maxChecks = opts.maxChecks ?? EVAL_GAP_CHECK_MAX;
  const topK = opts.topK ?? EVAL_GAP_CHECK_TOP_K;
  const searchFn = opts.searchFn;

  /** @type {object[]} */
  const out = (classified || []).map((c) => ({ ...c }));
  /** @type {object[]} */
  const checks = [];

  if (!searchFn || typeof call !== 'function') {
    return { classified: out, checks };
  }

  let used = 0;
  for (const entry of out) {
    if (used >= maxChecks) break;
    if (entry.class !== 'retrieval_sibling' && entry.class !== 'other') continue;
    const queryText = entry.query_text || entry.row?.query?.query_text || '';
    const verbsInQuery = queryGitVerbs(queryText);
    if (verbsInQuery.length >= 2) continue;

    used += 1;
    try {
      const searchOut = await searchFn(queryText, { limit: topK });
      const candidates = candidatesFromSearchOutput(searchOut, topK);
      if (!candidates.length) {
        entry.class = 'coverage_gap';
        entry.gap_goal = queryText;
        entry.gap_via = 'empty_retrieve';
        checks.push({
          command_id: entry.command_id,
          query_text: queryText,
          match_command_id: null,
          class: 'coverage_gap',
          reason: 'empty_retrieve',
        });
        continue;
      }

      const { messages } = renderPrompt('build/gap-check', {
        query_text: queryText,
        candidates_json: JSON.stringify(candidates, null, 2),
      });
      const judged = await call({
        schema: GapCheckSchema,
        messages,
      });
      const matchId =
        judged?.match_command_id == null ? null : Number(judged.match_command_id);
      const validMatch =
        matchId != null &&
        Number.isFinite(matchId) &&
        candidates.some((c) => c.command_id === matchId);

      if (validMatch) {
        entry.class = 'retrieval_sibling';
        entry.gap_match_command_id = matchId;
        entry.gap_via = 'gap_check_match';
        checks.push({
          command_id: entry.command_id,
          query_text: queryText,
          match_command_id: matchId,
          class: 'retrieval_sibling',
          reason: 'match',
        });
      } else {
        entry.class = 'coverage_gap';
        entry.gap_goal = queryText;
        entry.gap_via = 'gap_check_none';
        checks.push({
          command_id: entry.command_id,
          query_text: queryText,
          match_command_id: null,
          class: 'coverage_gap',
          reason: 'no_match',
        });
      }
    } catch (e) {
      log(`detectGaps fail: ${e?.message || e}`);
      checks.push({
        command_id: entry.command_id,
        query_text: queryText,
        error: String(e?.message || e),
      });
    }
  }

  return { classified: out, checks };
}
