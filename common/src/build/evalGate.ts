// @ts-nocheck
/**
 * Eval banks + Hit@display / judge-utility gate (schema v7).
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
} from '../db/constants.js';
import { verbFromCommandLine, buildVerbCoverage } from './coverage.js';
import { z } from 'zod';

/**
 * System prompt for the build-time utility judge (Pass A fallback).
 * Loaded from common/prompts/build/judge.md.
 */
export const JUDGE_SYSTEM_PROMPT = renderPromptRole('build/judge', 'system', {
  threshold: EVAL_JUDGE_UTILITY_THRESHOLD,
});

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

/** Normalize text for near-dup / overlap checks. */
export function normalizeQueryText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True if query has enough fidelity to the recipe (verb token + not a banned generic).
 * @param {string} queryText
 * @param {string} primaryVerb e.g. `git status`
 * @param {string[]} [priorNormalized] existing bank queries (normalized)
 */
export function goldenQueryAcceptable(queryText, primaryVerb, priorNormalized = []) {
  const q = normalizeQueryText(queryText);
  if (q.length < 6) return { ok: false, reason: 'too_short' };

  const verb = String(primaryVerb || '').toLowerCase();
  const verbToken = verb.replace(/^git\s+/, '').trim();
  if (verbToken && !new RegExp(`\\b${verbToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) {
    // Allow hyphenated verbs matched loosely (cherry-pick / cherrypick)
    const loose = verbToken.replace(/-/g, '[- ]?');
    if (!new RegExp(`\\b${loose}\\b`, 'i').test(q)) {
      return { ok: false, reason: 'missing_verb_token' };
    }
  }

  // Generic pickaxe/log-search template that poisoned the first ground run.
  if (
    /find the commit that introduced a specific string/.test(q) ||
    /introduced a specific string/.test(q)
  ) {
    if (verbToken !== 'log' && verbToken !== 'grep' && verbToken !== 'blame') {
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
  if (kinds.has('pin_nl')) {
    out.push(...loadBank('pin-nl.jsonl').map((r) => ({ ...r, kind: 'pin_nl' })));
  }
  return out;
}

/**
 * Write adversarial NL bank from canonical pin seed intents.
 * @param {{ goal_id: string, verb: string, goal_roles: string[], seed_intents: string[] }[]} pins
 * @param {Map<string, number>|Record<string, number>} [goalIdToCommandId]
 */
export function writePinNlBank(pins, goalIdToCommandId = {}) {
  const map =
    goalIdToCommandId instanceof Map
      ? goalIdToCommandId
      : new Map(Object.entries(goalIdToCommandId || {}));
  const rows = [];
  for (const pin of pins || []) {
    const command_id = map.get(pin.goal_id);
    if (command_id == null) continue;
    for (const intent of pin.seed_intents || []) {
      rows.push({
        query_text: intent,
        command_id,
        kind: 'pin_nl',
        goal_id: pin.goal_id,
        primary_verb: pin.verb,
        goal_roles: pin.goal_roles,
      });
    }
  }
  writeBank('pin-nl.jsonl', rows);
  return rows.length;
}

/**
 * Evaluate pin NL bank with Hit@display / verb Pass B (hard).
 */
export async function evaluatePinNlBank(searchFn, opts = {}) {
  const bank = loadBank('pin-nl.jsonl');
  if (!bank.length) {
    return { ok: true, skipped: true, total: 0, hitRate: 1, verbRate: 1 };
  }
  return evaluateBank(bank, searchFn, {
    ...opts,
    minHitAtDisplayRate: opts.minHitAtDisplayRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE,
    minPassRate: opts.minPassRate ?? EVAL_MIN_HIT_AT_DISPLAY_RATE, // pin NL uses Hit@display floor as Pass A too when judge optional
  });
}

/** Primary verb (`git <cmd>`) from a recipe row. */
export function primaryVerbFromRecipe(commandRow) {
  return verbFromCommandLine(primaryCommand(commandRow?.command_recipe ?? commandRow));
}

/**
 * Tag a golden (or other bank row) with mutation_kind / primary_verb.
 * @param {object} query
 * @param {{ mutation_kind?: string|null, primary_verb?: string }} meta
 */
export function tagGolden(query, meta = {}) {
  const out = { ...query };
  if (meta.mutation_kind !== undefined) out.mutation_kind = meta.mutation_kind;
  if (meta.primary_verb !== undefined) out.primary_verb = meta.primary_verb;
  return out;
}

/**
 * Append one evolve golden (tagged); extended/scrambled remain ground-only.
 * @returns {object} tagged golden row
 */
export function appendEvolveGolden(commandRow, goldenQuery) {
  const tagged = tagGolden(goldenQuery, {
    mutation_kind: commandRow.mutation_kind ?? null,
    primary_verb: primaryVerbFromRecipe(commandRow),
  });
  appendBank('golden.jsonl', [tagged]);
  return tagged;
}

export async function generateGoldenQuery(commandRow, commandId, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const steps = parseCommands(commandRow.command_recipe ?? commandRow);
  const listing = steps.map((s) => s.command).join('\n');
  const primary = steps[0]?.command || '';
  const primaryVerb = verbFromCommandLine(primary);
  const priorNormalized = (opts.priorQueries || []).map(normalizeQueryText);
  const maxAttempts = opts.maxAttempts ?? Math.max(2, VALIDATION_MAX_REGEN);

  const { messages } = renderPrompt('build/golden-query', {
    primary_verb: primaryVerb || 'unknown',
    primary,
    listing: listing || '(none)',
  });

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const out = await call({
      schema: GoldenQuerySchema,
      messages,
    });
    const check = goldenQueryAcceptable(out.query_text, primaryVerb, priorNormalized);
    if (check.ok) {
      return { query_text: out.query_text, command_id: commandId, kind: 'golden' };
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
  const { messages } = renderPrompt('build/expand-queries', {
    primary_verb: primaryVerb || 'unknown',
    seed: seed.query_text,
    primary,
    listing,
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
 * Miss â†’ strict utility judge; Pass if utility > 0.9.
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
 * Pass B: expected primary verb appears among displayed hit verbs.
 * @param {*} hitsOrResult
 * @param {string} expectedPrimaryVerb
 * @param {Record<string|number, string>} [recipeLookup] command_id â†’ primary_verb
 */
export function hitAtDisplayVerb(hitsOrResult, expectedPrimaryVerb, recipeLookup = {}) {
  if (!expectedPrimaryVerb) return false;
  const expected = String(expectedPrimaryVerb).toLowerCase();
  const displayed = displayedFromSearchOutput(hitsOrResult);
  return displayed.some((h) =>
    verbsFromHit(h, recipeLookup).some((v) => String(v).toLowerCase() === expected),
  );
}

/** @deprecated use hitAtDisplayVerb */
export function hitAt3Verb(hitsOrResult, expectedPrimaryVerb, recipeLookup = {}) {
  return hitAtDisplayVerb(hitsOrResult, expectedPrimaryVerb, recipeLookup);
}

export async function evaluateQuery(query, searchFn, opts = {}) {
  const threshold = opts.utilityThreshold ?? EVAL_JUDGE_UTILITY_THRESHOLD;
  const verbLookup = opts.verbLookup || {};
  const tSearch = Date.now();
  const raw = await searchFn(query.query_text, { limit: 3 });
  const searchMs = Date.now() - tSearch;
  const meta = displayMetaFromSearchOutput(raw);
  const displayed = meta.displayed;
  const passVerb = hitAtDisplayVerb(raw, query.primary_verb, verbLookup);

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
    { ...opts, utilityThreshold: threshold },
  );
}

/**
 * LLM judge for a Phase-1 miss (displayed set already retrieved).
 * @param {{ query: object, displayed: object[], alert?: string, status?: string, passVerb: boolean, searchMs?: number }} miss
 */
export async function judgeQueryMiss(miss, opts = {}) {
  const threshold = opts.utilityThreshold ?? EVAL_JUDGE_UTILITY_THRESHOLD;
  const call = opts.llmJsonObject || llmJsonObject;
  const displayed = miss.displayed ?? [];
  const tJudge = Date.now();
  let judge;
  try {
    const { messages } = renderPrompt('build/judge', {
      threshold,
      user_json: JSON.stringify({
        query: miss.query.query_text,
        expected_command_id: miss.query.command_id,
        alert: miss.alert ?? null,
        status: miss.status ?? null,
        display_results: displayed.map((h) => ({
          command_id: h.command_id ?? h.recipe_id,
          example: h.example,
          snippet: h.snippet,
        })),
      }),
    });
    judge = await call({
      schema: StrictJudgeSchema,
      messages,
    });
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

  const vote = {
    pass: judge.utility > threshold,
    passVerb: miss.passVerb,
    via: judge.utility > threshold ? 'judge' : 'ko',
    utility: judge.utility,
    reason: judge.reason,
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
        const r = await judgeQueryMiss(results[i], { ...opts, onJudgeVote });
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
