// @ts-nocheck
/**
 * Eval banks + Hit@display / judge-utility gate (schema v8).
 */
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { evalDataDir } from '../lib/paths.js';
import { llmJsonObject } from '../lib/llm.js';
import { renderPrompt, renderPromptRole } from '../lib/prompts.js';
import { StrictJudgeSchema } from '../schemas/command.js';
import { primaryCommand, parseCommands } from '../db/recipeFormat.js';
import pLimit from 'p-limit';
import {
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT_DISPLAY_RATE,
  EVAL_JUDGE_UTILITY_THRESHOLD,
  EVAL_COVERAGE_WARN_VERB_MIN,
  EVAL_COVERAGE_WARN_FRACTION,
  EVAL_CONCURRENCY,
  EVAL_PROGRESS_EVERY,
  EVAL_PROGRESS_HEARTBEAT_MS,
  VALIDATION_MAX_REGEN,
  EVAL_GATE_MIN_BANK_TOTAL,
  EVAL_GATE_MIN_BANK_COMPOSITION,
  EVAL_JUDGE_BORDERLINE_BAND,
  EVAL_JUDGE_VOTES,
} from '../db/constants.js';
import { verbFromCommandLine, buildVerbCoverage } from './coverage.js';
import {
  buildVerbFamilyIndex,
  verbsInFamily,
} from './evalImprove/verbFamilies.js';
import { z } from 'zod';

/**
 * System prompt for the build-time utility judge (Pass A fallback).
 * Loaded from common/prompts/build/judge.md.
 */
export const JUDGE_SYSTEM_PROMPT = renderPromptRole('build/judge', 'system', {});

/** Resolve eval bank concurrency (opts > env > default). */
export function resolveEvalConcurrency(opts = {}) {
  if (opts.concurrency != null && Number.isFinite(Number(opts.concurrency))) {
    return Math.max(1, Math.floor(Number(opts.concurrency)));
  }
  const env = process.env.GIT_GRASP_EVAL_CONCURRENCY;
  if (env != null && String(env).trim() !== '') {
    const n = Number(env);
    if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  }
  return EVAL_CONCURRENCY;
}

const GoldenQuerySchema = z.object({
  query_text: z.string().min(1),
});

const GoldenFidelitySchema = z.object({
  ok: z.boolean(),
});

/** Normalize text for near-dup / overlap checks. */
export function normalizeQueryText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract verb tokens (`status`, `stash`, …) from primaryVerb string(s).
 * Accepts a single `git <verb>` string or an array of them.
 * @param {string|string[]|null|undefined} primaryVerbs
 * @returns {string[]}
 */
export function verbTokensFromPrimaryVerbs(primaryVerbs) {
  const list = Array.isArray(primaryVerbs)
    ? primaryVerbs
    : primaryVerbs != null && String(primaryVerbs).trim() !== ''
      ? [primaryVerbs]
      : [];
  /** @type {string[]} */
  const tokens = [];
  for (const v of list) {
    const verb = String(v || '').toLowerCase();
    const token = verb.replace(/^git\s+/, '').trim();
    if (token) tokens.push(token);
  }
  return [...new Set(tokens)];
}

/**
 * All step verbs (`git <cmd>`) from a recipe row.
 * @param {object} commandRow
 * @returns {string[]}
 */
export function stepVerbsFromRecipe(commandRow) {
  const steps = parseCommands(commandRow?.command_recipe ?? commandRow);
  /** @type {string[]} */
  const out = [];
  for (const s of steps) {
    const v = verbFromCommandLine(s?.command);
    if (v) out.push(v);
  }
  return [...new Set(out)];
}

/**
 * True if query text contains any of the given verb tokens.
 * @param {string} queryText
 * @param {string[]} verbTokens
 */
export function queryHasVerbToken(queryText, verbTokens) {
  const q = String(queryText || '');
  for (const verbToken of verbTokens) {
    if (!verbToken) continue;
    if (new RegExp(`\\b${verbToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) {
      return true;
    }
    const loose = verbToken.replace(/-/g, '[- ]?');
    if (new RegExp(`\\b${loose}\\b`, 'i').test(q)) return true;
  }
  return false;
}

/**
 * True if query has enough fidelity to the recipe (verb token(s) + not a banned generic).
 * @param {string} queryText
 * @param {string|string[]} primaryVerb e.g. `git status` or list of step verbs
 * @param {string[]} [priorNormalized] existing bank queries (normalized)
 */
export function goldenQueryAcceptable(queryText, primaryVerb, priorNormalized = []) {
  const q = normalizeQueryText(queryText);
  if (q.length < 6) return { ok: false, reason: 'too_short' };

  const verbTokens = verbTokensFromPrimaryVerbs(primaryVerb);
  if (verbTokens.length && !queryHasVerbToken(q, verbTokens)) {
    return { ok: false, reason: 'missing_verb_token' };
  }

  // Generic pickaxe/log-search template that poisoned the first ground run.
  if (
    /find the commit that introduced a specific string/.test(q) ||
    /introduced a specific string/.test(q)
  ) {
    const allowPickaxe = verbTokens.some((t) => t === 'log' || t === 'grep' || t === 'blame');
    if (!allowPickaxe) {
      return { ok: false, reason: 'generic_pickaxe_template' };
    }
  }

  const prior = priorNormalized || [];
  if (prior.includes(q)) return { ok: false, reason: 'exact_dup' };
  // Near-dup: high token Jaccard with any prior
  const tokens = new Set(q.split(' ').filter((t) => t.length > 2));
  for (const p of prior) {
    const pt = new Set(p.split(' ').filter((t) => t.length > 2));
    if (!tokens.size || !pt.size) continue;
    let inter = 0;
    for (const t of tokens) if (pt.has(t)) inter += 1;
    const union = tokens.size + pt.size - inter;
    if (union && inter / union >= 0.85) return { ok: false, reason: 'near_dup' };
  }

  return { ok: true };
}

/** Deterministic fallback when LLM goldens fail fidelity checks. */
export function fallbackGoldenQuery(primaryLine, commandId) {
  const primary = String(primaryLine || 'git status').trim();
  const verb = verbFromCommandLine(primary) || 'git status';
  const token = verb.replace(/^git\s+/, '');
  return {
    query_text: `how do I use git ${token}`,
    command_id: commandId,
    kind: 'golden',
    fallback: true,
    report_only: true,
  };
}

export function isFallbackGoldenQuery(row) {
  if (row?.fallback || row?.report_only) return true;
  return /^how do i use git\s+\S+/i.test(String(row?.query_text || '').trim());
}

export { evalDataDir };

export function ensureEvalDirs() {
  mkdirSync(evalDataDir(), { recursive: true });
}

export function scrambleQuery(text, seed = 1) {
  // Light adversarial noise: optional adjacent word swap + one char typo.
  // (Full char-shuffle made queries unusable and poisoned the eval bank.)
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const words = String(text).split(/(\s+)/);
  const wordIdx = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i].trim()) wordIdx.push(i);
  }
  if (wordIdx.length >= 2 && rand() > 0.3) {
    const a = wordIdx[Math.floor(rand() * (wordIdx.length - 1))];
    const b = wordIdx[wordIdx.indexOf(a) + 1] ?? wordIdx[0];
    const tmp = words[a];
    words[a] = words[b];
    words[b] = tmp;
  }
  let out = words.join('');
  if (out.length > 4) {
    const chars = out.split('');
    const i = Math.floor(rand() * chars.length);
    if (/\w/.test(chars[i])) {
      chars[i] = String.fromCharCode(97 + Math.floor(rand() * 26));
    }
    out = chars.join('');
  }
  return out;
}

export function loadBank(fileName) {
  const p = path.join(evalDataDir(), fileName);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Fixed absolute floors for binding loop-phase gates.
 * @param {object[]} bank
 * @param {{ minTotal?: number, minComposition?: number }} [opts]
 */
export function evalBankMeetsFloors(bank, opts = {}) {
  const totalMin = opts.minTotal ?? EVAL_GATE_MIN_BANK_TOTAL;
  const compMin = opts.minComposition ?? EVAL_GATE_MIN_BANK_COMPOSITION;
  const rows = bank || [];
  const total = rows.length;
  const composition = rows.filter((r) => r?.mutation_kind === 'composition').length;
  return {
    ok: total >= totalMin && composition >= compMin,
    total,
    composition,
    totalMin,
    compMin,
  };
}

/**
 * Median of numbers (for judge re-votes).
 * @param {number[]} values
 */
export function medianNumber(values) {
  const xs = (values || []).filter((n) => typeof n === 'number' && Number.isFinite(n));
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function appendBank(fileName, rows) {
  ensureEvalDirs();
  const p = path.join(evalDataDir(), fileName);
  // Route fallback goldens out of the hard gate bank.
  let toWrite = rows;
  if (fileName === 'golden.jsonl') {
    const hard = [];
    const report = [];
    for (const r of rows) {
      if (isFallbackGoldenQuery(r)) report.push(r);
      else hard.push(r);
    }
    if (report.length) {
      const rp = path.join(evalDataDir(), 'golden-report.jsonl');
      appendFileSync(rp, report.map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
    toWrite = hard;
  }
  if (!toWrite.length) return;
  const body = toWrite.map((r) => JSON.stringify(r)).join('\n') + '\n';
  appendFileSync(p, body);
}

export function writeBank(fileName, rows) {
  ensureEvalDirs();
  const p = path.join(evalDataDir(), fileName);
  writeFileSync(
    p,
    rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''),
  );
}

export function activeEvaluationBank(opts = {}) {
  const kinds = new Set(opts.kinds || ['golden', 'extended', 'scrambled']);
  const excludeFallbacks = opts.excludeFallbacks !== false;
  const out = [];
  if (kinds.has('golden')) {
    out.push(
      ...loadBank('golden.jsonl')
        .filter((r) => !(excludeFallbacks && isFallbackGoldenQuery(r)))
        .map((r) => ({ ...r, kind: 'golden' })),
    );
  }
  if (kinds.has('extended')) {
    out.push(...loadBank('extended.jsonl').map((r) => ({ ...r, kind: 'extended' })));
  }
  if (kinds.has('scrambled')) {
    out.push(...loadBank('scrambled.jsonl').map((r) => ({ ...r, kind: 'scrambled' })));
  }
  return out;
}

/** Primary verb (`git <cmd>`) from a recipe row. */
export function primaryVerbFromRecipe(commandRow) {
  return verbFromCommandLine(primaryCommand(commandRow?.command_recipe ?? commandRow));
}

/**
 * Tag a golden (or other bank row) with mutation_kind / primary_verb / source.
 * @param {object} query
 * @param {{ mutation_kind?: string|null, primary_verb?: string, source?: string }} meta
 */
export function tagGolden(query, meta = {}) {
  const out = { ...query };
  if (meta.mutation_kind !== undefined) out.mutation_kind = meta.mutation_kind;
  if (meta.primary_verb !== undefined) out.primary_verb = meta.primary_verb;
  if (meta.source !== undefined) out.source = meta.source;
  else if (out.source == null) out.source = 'llm';
  return out;
}

/**
 * Append one evolve golden (tagged with mutation_kind + primary_verb + source).
 * @returns {object} tagged golden row
 */
export function appendEvolveGolden(commandRow, goldenQuery) {
  const tagged = tagGolden(goldenQuery, {
    mutation_kind: commandRow.mutation_kind ?? null,
    primary_verb: primaryVerbFromRecipe(commandRow),
    source: goldenQuery?.source || 'llm',
  });
  appendBank('golden.jsonl', [tagged]);
  return tagged;
}

/**
 * Tag and append extended + scrambled banks for a recipe (ground or evolve).
 * @param {object} commandRow
 * @param {object[]} extendedRows raw expandQueries output
 * @param {number} commandId
 * @returns {{ extended: object[], scrambled: object[] }}
 */
export function appendExtendedScrambledBanks(commandRow, extendedRows, commandId) {
  const meta = {
    mutation_kind: commandRow.mutation_kind ?? null,
    primary_verb: primaryVerbFromRecipe(commandRow),
    source: 'llm',
  };
  const extended = (extendedRows || []).map((e) =>
    tagGolden(
      {
        query_text: e.query_text,
        command_id: commandId,
        kind: 'extended',
      },
      meta,
    ),
  );
  const scrambled = extended.map((e, j) =>
    tagGolden(
      {
        query_text: scrambleQuery(e.query_text, Number(commandId) + j),
        command_id: commandId,
        kind: 'scrambled',
      },
      meta,
    ),
  );
  appendBank('extended.jsonl', extended);
  appendBank('scrambled.jsonl', scrambled);
  return { extended, scrambled };
}

export async function generateGoldenQuery(commandRow, commandId, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  if (!commandRow) {
    return {
      query_text: `how do I use command ${commandId}`,
      command_id: commandId,
      kind: 'golden',
    };
  }
  const steps = parseCommands(commandRow.command_recipe ?? commandRow);
  const listing = steps.map((s) => s.command).join('\n');
  const primary = steps[0]?.command || '';
  const primaryVerb = verbFromCommandLine(primary);
  const stepVerbs = stepVerbsFromRecipe(commandRow);
  const priorNormalized = (opts.priorQueries || []).map(normalizeQueryText);
  const maxAttempts = opts.maxAttempts ?? Math.max(2, VALIDATION_MAX_REGEN);
  const mutationKind =
    commandRow.mutation_kind != null && String(commandRow.mutation_kind).trim() !== ''
      ? String(commandRow.mutation_kind)
      : 'ground';
  const isComposition = mutationKind === 'composition';
  const initialState = String(commandRow.initial_state ?? '').trim() || '(none)';
  const title =
    commandRow.title != null && String(commandRow.title).trim() !== ''
      ? String(commandRow.title).trim()
      : '(none)';

  // Ground: primary verb only. Composition: any step verb.
  const verbCheckList = isComposition
    ? stepVerbs.length
      ? stepVerbs
      : primaryVerb
        ? [primaryVerb]
        : []
    : primaryVerb
      ? [primaryVerb]
      : [];

  // User-simulator: prompt sees title + initial_state only (not recipe steps).
  // Fidelity grader below still gets full listing.
  const { messages } = renderPrompt('build/golden-query', {
    primary_verb: primaryVerb || 'unknown',
    mutation_kind: mutationKind,
    initial_state: initialState,
    title,
    is_composition: isComposition,
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const out = await call({
      schema: GoldenQuerySchema,
      messages,
    });
    const check = goldenQueryAcceptable(out.query_text, verbCheckList, priorNormalized);
    if (check.ok) {
      return { query_text: out.query_text, command_id: commandId, kind: 'golden' };
    }

    // Composition: when the only failure is missing verb token, LLM fidelity check.
    if (isComposition && check.reason === 'missing_verb_token') {
      const baseCheck = goldenQueryAcceptable(out.query_text, [], priorNormalized);
      if (baseCheck.ok) {
        const { messages: fidelityMessages } = renderPrompt('build/golden-fidelity', {
          title,
          primary_verb: primaryVerb || 'unknown',
          mutation_kind: mutationKind,
          query_text: out.query_text,
          initial_state: initialState,
          listing: listing || '(none)',
        });
        try {
          const fidelity = await call({
            schema: GoldenFidelitySchema,
            messages: fidelityMessages,
          });
          if (fidelity?.ok === true) {
            return {
              query_text: out.query_text,
              command_id: commandId,
              kind: 'golden',
              fidelity: 'llm',
            };
          }
        } catch {
          // treat as reject; retry / fallback
        }
      }
    }
  }

  return fallbackGoldenQuery(primary, commandId);
}

export async function expandQueries(seed, commandRow, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const ExpandedSchema = z.object({
    variants: z.array(z.string()).length(3),
  });
  const steps = parseCommands(commandRow.command_recipe ?? commandRow);
  const listing = steps.map((s) => s.command).join('\n');
  const primary = steps[0]?.command || '';
  const primaryVerb = verbFromCommandLine(primary);
  const mutationKind =
    commandRow.mutation_kind != null && String(commandRow.mutation_kind).trim() !== ''
      ? String(commandRow.mutation_kind)
      : seed.mutation_kind != null && String(seed.mutation_kind).trim() !== ''
        ? String(seed.mutation_kind)
        : 'ground';
  const initialState = String(commandRow.initial_state ?? '').trim() || '(none)';
  const { messages } = renderPrompt('build/expand-queries', {
    primary_verb: primaryVerb || 'unknown',
    seed: seed.query_text,
    primary,
    listing,
    mutation_kind: mutationKind,
    initial_state: initialState,
  });
  const out = await call({
    schema: ExpandedSchema,
    messages,
  });
  return out.variants.map((query_text) => ({
    query_text,
    command_id: seed.command_id,
    kind: 'extended',
  }));
}

/**
 * Gate: Hit@display exact command_id on CLI-shown `displayResults`.
 * Miss → strict utility judge; Pass if utility >= 0.9.
 *
 * searchFn may return either:
 * - SearchHybridResult `{ results, displayResults, alert, status, ... }` (preferred)
 * - Or a bare hit array (legacy â€” treated as already-displayed)
 */
export function displayMetaFromSearchOutput(hitsOrResult) {
  if (Array.isArray(hitsOrResult)) {
    return { displayed: hitsOrResult.slice(0, 3), alert: undefined, status: undefined };
  }
  const display = hitsOrResult?.displayResults;
  const displayed = Array.isArray(display) ? display.slice(0, 3) : [];
  return {
    displayed,
    alert: hitsOrResult?.alert,
    status: hitsOrResult?.status,
  };
}

/** CLI-shown hits from search output (displayResults, or bare array legacy). */
export function displayedFromSearchOutput(hitsOrResult) {
  return displayMetaFromSearchOutput(hitsOrResult).displayed;
}

/** @deprecated use displayedFromSearchOutput */
export function top3FromSearchOutput(hitsOrResult) {
  return displayedFromSearchOutput(hitsOrResult);
}

export function hitAtDisplay(hitsOrResult, commandId) {
  const displayed = displayedFromSearchOutput(hitsOrResult);
  return displayed.some(
    (h) => Number(h.command_id ?? h.recipe_id) === Number(commandId),
  );
}

/** @deprecated use hitAtDisplay */
export function hitAt3(hitsOrResult, commandId) {
  return hitAtDisplay(hitsOrResult, commandId);
}

/** Verbs present on a search hit (lookup map and/or snippet/example parse). */
export function verbsFromHit(hit, verbLookup = {}) {
  const id = Number(hit.command_id ?? hit.recipe_id);
  const fromLookup = verbLookup[id] ?? verbLookup[String(id)];
  if (fromLookup) return [fromLookup];
  const text = [hit.example, hit.snippet, hit.command].filter(Boolean).join('\n');
  const verbs = new Set();
  for (const line of String(text).split(/\n/)) {
    for (const m of line.matchAll(/\bgit\s+[a-z0-9][-a-z0-9]*/gi)) {
      const v = verbFromCommandLine(m[0]);
      if (v) verbs.add(v);
    }
  }
  return [...verbs];
}

/**
 * Pass B: expected primary verb (or verb-family mate) among displayed hit verbs.
 * @param {*} hitsOrResult
 * @param {string} expectedPrimaryVerb
 * @param {Record<string|number, string>} [recipeLookup] command_id → primary_verb
 * @param {Map<string, Set<string>>} [familyIndex]
 */
export function hitAtDisplayVerb(
  hitsOrResult,
  expectedPrimaryVerb,
  recipeLookup = {},
  familyIndex = null,
) {
  if (!expectedPrimaryVerb) return false;
  const expected = String(expectedPrimaryVerb).toLowerCase();
  const family = familyIndex
    ? verbsInFamily(expected, familyIndex)
    : new Set([expected]);
  const displayed = displayedFromSearchOutput(hitsOrResult);
  return displayed.some((h) =>
    verbsFromHit(h, recipeLookup).some((v) =>
      family.has(String(v).toLowerCase()),
    ),
  );
}

/** @deprecated use hitAtDisplayVerb */
export function hitAt3Verb(hitsOrResult, expectedPrimaryVerb, recipeLookup = {}) {
  return hitAtDisplayVerb(hitsOrResult, expectedPrimaryVerb, recipeLookup);
}

export async function evaluateQuery(query, searchFn, opts = {}) {
  const threshold = opts.utilityThreshold ?? EVAL_JUDGE_UTILITY_THRESHOLD;
  const verbLookup = opts.verbLookup || {};
  const familyIndex = opts.familyIndex || buildVerbFamilyIndex();
  const tSearch = Date.now();
  const raw = await searchFn(query.query_text, { limit: 3 });
  const searchMs = Date.now() - tSearch;
  const meta = displayMetaFromSearchOutput(raw);
  const displayed = meta.displayed;
  const passVerb = hitAtDisplayVerb(
    raw,
    query.primary_verb,
    verbLookup,
    familyIndex,
  );

  if (hitAtDisplay(raw, query.command_id)) {
    return {
      pass: true,
      passVerb,
      via: 'hit@display',
      displayed,
      alert: meta.alert,
      status: meta.status,
      query,
      searchMs,
      judgeMs: 0,
    };
  }

  if (opts.searchOnly) {
    return {
      pass: false,
      passVerb,
      via: 'miss',
      displayed,
      alert: meta.alert,
      status: meta.status,
      query,
      searchMs,
      judgeMs: 0,
    };
  }

  return judgeQueryMiss(
    {
      pass: false,
      passVerb,
      via: 'miss',
      displayed,
      alert: meta.alert,
      status: meta.status,
      query,
      searchMs,
      judgeMs: 0,
    },
    { ...opts, utilityThreshold: threshold, familyIndex },
  );
}

/**
 * LLM judge for a Phase-1 miss (displayed set already retrieved).
 * Borderline utilities (± band around threshold) take additional votes and use median.
 * @param {{ query: object, displayed: object[], alert?: string, status?: string, passVerb: boolean, searchMs?: number }} miss
 */
export async function judgeQueryMiss(miss, opts = {}) {
  const threshold = opts.utilityThreshold ?? EVAL_JUDGE_UTILITY_THRESHOLD;
  const band = opts.borderlineBand ?? EVAL_JUDGE_BORDERLINE_BAND;
  const votesWanted = Math.max(1, opts.judgeVotes ?? EVAL_JUDGE_VOTES);
  const call = opts.llmJsonObject || llmJsonObject;
  const displayed = miss.displayed ?? [];
  const familyIndex = opts.familyIndex || buildVerbFamilyIndex();
  const acceptable = [
    ...verbsInFamily(miss.query?.primary_verb, familyIndex),
  ];
  const tJudge = Date.now();

  const oneVote = async () => {
    const { messages } = renderPrompt('build/judge', {
      user_json: JSON.stringify({
        query: miss.query.query_text,
        expected_command_id: miss.query.command_id,
        acceptable_primary_verbs: acceptable,
        alert: miss.alert ?? null,
        status: miss.status ?? null,
        display_results: displayed.map((h) => ({
          command_id: h.command_id ?? h.recipe_id,
          example: h.example,
          snippet: h.snippet,
        })),
      }),
    });
    return call({
      schema: StrictJudgeSchema,
      messages,
    });
  };

  /** @type {number[]} */
  const utilities = [];
  /** @type {string[]} */
  const reasons = [];
  try {
    const first = await oneVote();
    utilities.push(Number(first.utility));
    reasons.push(String(first.reason || ''));

    const u0 = utilities[0];
    const borderline =
      typeof u0 === 'number' &&
      Math.abs(u0 - threshold) <= band &&
      votesWanted > 1;
    if (borderline) {
      for (let i = 1; i < votesWanted; i += 1) {
        const next = await oneVote();
        utilities.push(Number(next.utility));
        reasons.push(String(next.reason || ''));
      }
    }
  } catch (e) {
    const errResult = {
      pass: false,
      passVerb: miss.passVerb,
      via: 'judge_error',
      reason: e?.message || String(e),
      displayed,
      alert: miss.alert,
      status: miss.status,
      query: miss.query,
      searchMs: miss.searchMs ?? 0,
      judgeMs: Date.now() - tJudge,
    };
    if (typeof opts.onJudgeVote === 'function') opts.onJudgeVote(errResult);
    return errResult;
  }

  const utility = utilities.length > 1 ? medianNumber(utilities) : utilities[0];
  // Prefer the reason from the vote closest to the median utility.
  let reason = reasons[0] || '';
  if (utilities.length > 1) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < utilities.length; i += 1) {
      const d = Math.abs(utilities[i] - utility);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    reason = reasons[best] || reason;
  }

  const vote = {
    pass: utility >= threshold,
    passVerb: miss.passVerb,
    via: utility >= threshold ? 'judge' : 'ko',
    utility,
    reason,
    judgeVotes: utilities,
    displayed,
    alert: miss.alert,
    status: miss.status,
    query: miss.query,
    searchMs: miss.searchMs ?? 0,
    judgeMs: Date.now() - tJudge,
  };
  if (typeof opts.onJudgeVote === 'function') opts.onJudgeVote(vote);
  return vote;
}

/**
 * Aggregate Pass A rates by mutation_kind.
 * @param {Array<{ pass: boolean, query?: { mutation_kind?: string|null } }>} results
 */
export function stratifyResultsByMutationKind(results) {
  /** @type {Record<string, { passed: number, total: number, rate: number }>} */
  const buckets = {};
  for (const r of results) {
    const raw = r.query?.mutation_kind;
    const key = raw == null ? 'null' : String(raw);
    if (!buckets[key]) buckets[key] = { passed: 0, total: 0, rate: 0 };
    buckets[key].total += 1;
    if (r.pass) buckets[key].passed += 1;
  }
  for (const b of Object.values(buckets)) {
    b.rate = b.total ? b.passed / b.total : 0;
  }
  return buckets;
}

/** Minimum integer hits needed so hitRate + 1e-9 >= minRate. */
export function minCountForRate(minRate, total) {
  if (total <= 0) return 0;
  return Math.max(0, Math.ceil(minRate * total - 1e-9));
}

/**
 * Evaluate golden bank in two phases:
 * 1) Search-only Hit@display (early-exit if gate already impossible)
 * 2) LLM judge on misses only (skipped entirely if Hit@display gate fails)
 *
 * Dual hard gate:
 * - Hit@display-only rate >= minHitAtDisplayRate (before LLM)
 * - Pass A (Hit@display OR judge) rate >= minPassRate (after LLM)
 *
 * @param {object[]} bank
 * @param {(q: string, opts?: object) => Promise<*>} searchFn
 * @param {object} [opts]
 */
export async function evaluateBank(bank, searchFn, opts = {}) {
  const minPassRate = opts.minPassRate ?? EVAL_MIN_PASS_RATE;
  const minHitAtDisplayRate = opts.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE;
  const concurrency = resolveEvalConcurrency(opts);
  const progressEvery = opts.progressEvery ?? EVAL_PROGRESS_EVERY;
  const heartbeatMs = opts.progressHeartbeatMs ?? EVAL_PROGRESS_HEARTBEAT_MS;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  const onJudgeVote = typeof opts.onJudgeVote === 'function' ? opts.onJudgeVote : null;
  const onSkipJudge = typeof opts.onSkipJudge === 'function' ? opts.onSkipJudge : null;
  const familyIndex = opts.familyIndex || buildVerbFamilyIndex();
  const total = bank.length;
  const results = new Array(total);
  const startedAt = Date.now();
  const minHitsNeeded = minCountForRate(minHitAtDisplayRate, total);
  const minPassNeeded = minCountForRate(minPassRate, total);

  let completed = 0;
  let passedSoFar = 0;
  let hit = 0;
  let judge = 0;
  let ko = 0;
  let judgeError = 0;
  let skipped = 0;
  let lastProgressAt = startedAt;
  let searchMsTotal = 0;
  let judgeMsTotal = 0;
  let phase1Abort = false;
  let phase2Abort = false;
  let skippedJudge = false;

  const emitProgress = (force = false, phase = 'search') => {
    if (!onProgress) return;
    const now = Date.now();
    const dueCount = completed === total || completed % progressEvery === 0;
    const dueTime = now - lastProgressAt >= heartbeatMs;
    if (!force && !dueCount && !dueTime) return;
    lastProgressAt = now;
    const rate = completed ? passedSoFar / completed : 0;
    const hitRate = total ? hit / total : 0;
    onProgress({
      done: completed,
      total,
      passed: passedSoFar,
      rate,
      hitRate,
      hit,
      judge,
      ko,
      judgeError,
      skipped,
      phase,
      elapsedSec: Math.round((now - startedAt) / 1000),
      concurrency,
    });
  };

  if (onProgress && total > 0) {
    onProgress({
      done: 0,
      total,
      passed: 0,
      rate: 0,
      hitRate: 0,
      hit: 0,
      judge: 0,
      ko: 0,
      judgeError: 0,
      skipped: 0,
      phase: 'search',
      elapsedSec: 0,
      concurrency,
    });
  }

  const limit = pLimit(concurrency);
  const phase1Started = Date.now();

  // Phase 1: search only
  await Promise.all(
    bank.map((q, i) =>
      limit(async () => {
        if (phase1Abort) {
          results[i] = {
            pass: false,
            passVerb: false,
            via: 'skipped',
            displayed: [],
            query: q,
            searchMs: 0,
            judgeMs: 0,
          };
          completed += 1;
          skipped += 1;
          emitProgress(false, 'search');
          return;
        }
        const r = await evaluateQuery(q, searchFn, {
          ...opts,
          familyIndex,
          searchOnly: true,
          onJudgeVote: undefined,
        });
        results[i] = r;
        searchMsTotal += r.searchMs || 0;
        completed += 1;
        if (r.via === 'hit@display') {
          hit += 1;
          passedSoFar += 1;
        }
        const remaining = total - completed;
        if (hit + remaining < minHitsNeeded) {
          phase1Abort = true;
        }
        emitProgress(false, 'search');
      }),
    ),
  );
  const phase1Ms = Date.now() - phase1Started;
  emitProgress(true, 'search');

  const hitPassed = results.filter((r) => r.via === 'hit@display').length;
  const hitRate = total ? hitPassed / total : 1;
  const okHit = hitRate + 1e-9 >= minHitAtDisplayRate;

  if (!okHit) {
    skippedJudge = true;
    for (let i = 0; i < total; i += 1) {
      if (!results[i]) {
        results[i] = {
          pass: false,
          passVerb: false,
          via: 'skipped',
          displayed: [],
          query: bank[i],
          searchMs: 0,
          judgeMs: 0,
        };
      }
    }
    if (onSkipJudge) {
      onSkipJudge({ hitRate, hitPassed, total, minHitAtDisplayRate, phase1Abort });
    }
    const verbPassed = results.filter((r) => r.passVerb).length;
    return {
      ok: false,
      okHit: false,
      okPass: false,
      passed: hitPassed,
      hitPassed,
      judgePassed: 0,
      total,
      rate: total ? hitPassed / total : 1,
      hitRate,
      minPassRate,
      minHitAtDisplayRate,
      verbPassed,
      verbTotal: total,
      verbRate: total ? verbPassed / total : 1,
      byMutationKind: stratifyResultsByMutationKind(results),
      judgeSummary: summarizeJudgeVotes(results),
      skippedJudge: true,
      timing: {
        searchMs: searchMsTotal,
        judgeMs: 0,
        phase1Ms,
        phase2Ms: 0,
      },
      results,
    };
  }

  // Phase 2: judge misses only
  const missIdx = [];
  for (let i = 0; i < total; i += 1) {
    if (results[i]?.via === 'miss') missIdx.push(i);
  }

  completed = hitPassed; // progress: hits already "done" for pass tracking
  passedSoFar = hitPassed;
  let missDone = 0;
  const phase2Started = Date.now();

  await Promise.all(
    missIdx.map((i) =>
      limit(async () => {
        if (phase2Abort) {
          results[i] = {
            ...results[i],
            pass: false,
            via: 'skipped',
          };
          skipped += 1;
          missDone += 1;
          completed += 1;
          emitProgress(false, 'judge');
          return;
        }
        const r = await judgeQueryMiss(results[i], {
          ...opts,
          familyIndex,
          onJudgeVote,
        });
        results[i] = r;
        judgeMsTotal += r.judgeMs || 0;
        missDone += 1;
        completed += 1;
        if (r.pass) {
          passedSoFar += 1;
          judge += 1;
        } else if (r.via === 'judge_error') {
          judgeError += 1;
        } else {
          ko += 1;
        }
        const remainingMisses = missIdx.length - missDone;
        if (passedSoFar + remainingMisses < minPassNeeded) {
          phase2Abort = true;
        }
        emitProgress(false, 'judge');
      }),
    ),
  );
  const phase2Ms = Date.now() - phase2Started;
  emitProgress(true, 'judge');

  const passed = results.filter((r) => r.pass).length;
  const judgePassed = results.filter((r) => r.via === 'judge').length;
  const rate = total ? passed / total : 1;
  const okPass = rate + 1e-9 >= minPassRate;
  const verbPassed = results.filter((r) => r.passVerb).length;
  const verbTotal = total;
  const verbRate = verbTotal ? verbPassed / verbTotal : 1;
  const byMutationKind = stratifyResultsByMutationKind(results);
  const judgeSummary = summarizeJudgeVotes(results);
  return {
    ok: okHit && okPass,
    okHit,
    okPass,
    passed,
    hitPassed,
    judgePassed,
    total,
    rate,
    hitRate,
    minPassRate,
    minHitAtDisplayRate,
    verbPassed,
    verbTotal,
    verbRate,
    byMutationKind,
    judgeSummary,
    skippedJudge: false,
    timing: {
      searchMs: searchMsTotal,
      judgeMs: judgeMsTotal,
      phase1Ms,
      phase2Ms,
    },
    results,
  };
}

/** Aggregate frequent judge reasons for a final log line. */
export function summarizeJudgeVotes(results, { topN = 8 } = {}) {
  const votes = (results || []).filter(
    (r) => r.via === 'judge' || r.via === 'ko' || r.via === 'judge_error',
  );
  /** @type {Record<string, { count: number, pass: number, ko: number, sample: string }>} */
  const buckets = {};
  for (const r of votes) {
    const raw = String(r.reason || '(no reason)').replace(/\s+/g, ' ').trim();
    const key = raw.length > 120 ? `${raw.slice(0, 117)}...` : raw;
    if (!buckets[key]) buckets[key] = { count: 0, pass: 0, ko: 0, sample: raw };
    buckets[key].count += 1;
    if (r.pass) buckets[key].pass += 1;
    else buckets[key].ko += 1;
  }
  const topReasons = Object.values(buckets)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
  return {
    judgeCalls: votes.length,
    judgePass: votes.filter((r) => r.via === 'judge').length,
    judgeKo: votes.filter((r) => r.via === 'ko').length,
    judgeError: votes.filter((r) => r.via === 'judge_error').length,
    topReasons,
  };
}

/** Format evaluateBank onProgress payload for build logs. */
export function formatEvalProgress(p) {
  const rate = (p.rate ?? 0).toFixed(2);
  const hitRate = (p.hitRate ?? 0).toFixed(2);
  const phase = p.phase ? ` phase=${p.phase}` : '';
  return (
    `eval progress ${p.done}/${p.total} passA=${rate} hit@display=${hitRate}` +
    ` hit=${p.hit ?? 0} judge=${p.judge ?? 0}` +
    ` ko=${p.ko ?? 0} judge_error=${p.judgeError ?? 0} elapsed=${p.elapsedSec ?? 0}s` +
    ` concurrency=${p.concurrency ?? '?'}${phase}`
  );
}

/** Format eval wall-clock timing for build logs. */
export function formatEvalTiming(timing) {
  if (!timing) return 'timing eval (none)';
  const s = (ms) => ((ms || 0) / 1000).toFixed(1);
  return (
    `timing eval search=${s(timing.searchMs)}s judge=${s(timing.judgeMs)}s` +
    ` phase1=${s(timing.phase1Ms)}s phase2=${s(timing.phase2Ms)}s`
  );
}

/** Format evolve wall-clock timing for build logs. */
export function formatEvolveTiming(timing) {
  if (!timing) return 'timing evolve (none)';
  const s = (ms) => ((ms || 0) / 1000).toFixed(1);
  return (
    `timing evolve llm=${s(timing.llmMs)}s sandbox=${s(timing.sandboxMs)}s` +
    ` intents=${s(timing.intentsMs)}s golden=${s(timing.goldenMs)}s` +
    ` persist=${s(timing.persistMs)}s parents=${timing.parentsDone ?? 0}`
  );
}

/** One/multi-line log string for dual gate + stratified + Pass B + judge summary. */
export function formatEvalReport(evalResult) {
  const rate = (evalResult.rate ?? 0).toFixed(2);
  const hitRate = (evalResult.hitRate ?? 0).toFixed(2);
  const lines = [
    `eval hit@display=${hitRate} (${evalResult.hitPassed ?? 0}/${evalResult.total})` +
      ` okHit=${evalResult.okHit} minHitAtDisplay=${evalResult.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE}`,
    `eval passA=${rate} (${evalResult.passed}/${evalResult.total})` +
      ` okPass=${evalResult.okPass} minPassRate=${evalResult.minPassRate}` +
      ` (hit=${evalResult.hitPassed ?? 0} judge=${evalResult.judgePassed ?? 0})`,
    `eval overall ok=${evalResult.ok} (requires hit@display>=min AND passA>=min)`,
  ];
  if (evalResult.skippedJudge) {
    lines.push(
      `eval skipJudge hitRate=${hitRate} < minHitAtDisplay=${evalResult.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE}`,
    );
  }
  const by = evalResult.byMutationKind || {};
  const kindParts = Object.keys(by)
    .sort()
    .map((k) => `${k}=${(by[k].rate ?? 0).toFixed(2)}`);
  if (kindParts.length) {
    lines.push(`eval byKind ${kindParts.join(' ')}`);
  }
  const vr = (evalResult.verbRate ?? 0).toFixed(2);
  lines.push(
    `eval verbPassB=${vr} (${evalResult.verbPassed ?? 0}/${evalResult.verbTotal ?? 0})`,
  );
  const js = evalResult.judgeSummary;
  if (js) {
    lines.push(
      `eval judgeSummary calls=${js.judgeCalls} pass=${js.judgePass} ko=${js.judgeKo} error=${js.judgeError}`,
    );
    for (const r of js.topReasons || []) {
      lines.push(
        `eval judgeReason n=${r.count} pass=${r.pass} ko=${r.ko} | ${r.sample}`,
      );
    }
  }
  if (evalResult.timing) {
    lines.push(formatEvalTiming(evalResult.timing));
  }
  return lines.join('\n');
}

/** Format a single judge vote for live logs. */
export function formatJudgeVote(vote) {
  const util =
    vote.utility == null ? '-' : Number(vote.utility).toFixed(2);
  const q = String(vote.query?.query_text || '').slice(0, 60);
  const reason = String(vote.reason || '').replace(/\s+/g, ' ').slice(0, 140);
  return `eval judge vote=${vote.via} utility=${util} pass=${vote.pass} q="${q}" reason="${reason}"`;
}

/**
 * Soft coverage report at promote (warn only; does not block).
 * @param {object[]} rows
 * @param {string[]} taxonomyVerbs
 * @param {{ minRecipes?: number, warnFraction?: number }} [opts]
 */
export function buildCoveragePromoteReport(rows, taxonomyVerbs, opts = {}) {
  const minRecipes = opts.minRecipes ?? EVAL_COVERAGE_WARN_VERB_MIN;
  const warnFraction = opts.warnFraction ?? EVAL_COVERAGE_WARN_FRACTION;
  const coverage = buildVerbCoverage(rows);
  const verbs = taxonomyVerbs || [];
  const sparseVerbs = [];
  let withMin = 0;
  for (const verb of verbs) {
    const count = coverage[verb]?.count ?? 0;
    if (count >= minRecipes) withMin += 1;
    else sparseVerbs.push(verb);
  }
  const fractionWithMinRecipes = verbs.length ? withMin / verbs.length : 1;
  const warn = fractionWithMinRecipes + 1e-9 < warnFraction;
  const summary = `coverage ${withMin}/${verbs.length} verbs have â‰¥${minRecipes} recipes (fraction=${fractionWithMinRecipes.toFixed(2)}${warn ? ' WARN' : ''})`;
  return {
    fractionWithMinRecipes,
    warn,
    sparseVerbs,
    summary,
    minRecipes,
    warnFraction,
    withMin,
    taxonomyCount: verbs.length,
  };
}

/** Write coverage report JSON under common/data/eval/. */
export function writeCoveragePromoteReport(report, fileName = 'coverage-report.json') {
  ensureEvalDirs();
  const p = path.join(evalDataDir(), fileName);
  writeFileSync(p, JSON.stringify(report, null, 2) + '\n');
  return p;
}

/** Build command_id â†’ primary_verb map from command rows. */
export function verbLookupFromRows(rows) {
  /** @type {Record<number, string>} */
  const map = {};
  for (const row of rows || []) {
    const v = primaryVerbFromRecipe(row);
    if (v && row.row_id != null) map[row.row_id] = v;
  }
  return map;
}
