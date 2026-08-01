// @ts-nocheck
import type { Thresholds } from '../schemas/thresholds.js';
import type { SkillLevelText } from '../lib/skills.js';
import { normalizeSkillLevelText } from '../lib/skills.js';
import { profileQuery } from './profile.js';
import { collapseToCommands } from './collapse.js';
import {
  computeConfidence,
  fuseScores,
  minMaxNormalize,
  normalizeBm25Batch,
  resolveDisplayCount,
  diversifyByRecipe,
  nextDistinctRecipeScore,
} from './fusion.js';
import { DEFAULT_RECALL_K } from '../db/constants.js';

export type HybridHit = {
  command_id: number;
  commands: { command?: string; comment?: string }[];
  example: string;
  snippet: string;
  risk: number;
  skill_level?: string;
  intent_category?: string;
  intent_text?: string;
  score?: number;
  score_cosine?: number;
  score_bm25?: number;
  score_hybrid?: number;
  [key: string]: unknown;
};

export type SearchHybridResult = {
  status: 'ok' | 'empty';
  confidence: number;
  results: HybridHit[];
  displayResults: HybridHit[];
  blend: { alpha: number; beta: number };
  preferredSkill: SkillLevelText;
  query: string;
  alert?: 'none' | 'yellow' | 'orange' | 'red';
};

export function normalizeQuery(query: string, enabled = true): string {
  if (!enabled) return String(query || '');
  return String(query || '').trim().replace(/\s+/g, ' ');
}

function tieBreak(a: {
  stepCount: number;
  command_recipe_json: string;
  score: number;
  command_id: number;
}, b: typeof a): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.stepCount !== b.stepCount) return a.stepCount - b.stepCount;
  const lex = a.command_recipe_json.localeCompare(b.command_recipe_json);
  if (lex !== 0) return lex;
  return a.command_id - b.command_id;
}

/**
 * Shared hybrid search core (CLI / web / eval).
 * Ports: embed, knn, fts, hydrate.
 */
export async function searchHybrid(opts: {
  query: string;
  thresholds: Thresholds;
  preferredSkillOverride?: SkillLevelText | number | string | null;
  verbs?: readonly string[];
  embed: () => Promise<Float32Array | number[]>;
  knn: (
    vec: Float32Array | number[],
    k: number,
  ) => Promise<unknown[]> | unknown[];
  fts: (
    q: string,
    k: number,
  ) => Promise<{ command_id: number; bm25: number }[]> | { command_id: number; bm25: number }[];
  hydrate: (commandIds: number[]) => Promise<HybridHit[]> | HybridHit[];
}): Promise<SearchHybridResult> {
  const thr = opts.thresholds;
  const q = normalizeQuery(opts.query, thr.normalizeQuery !== false);
  const recallK = thr.recallK ?? DEFAULT_RECALL_K;

  let preferredOverride: SkillLevelText | null = null;
  if (opts.preferredSkillOverride != null && opts.preferredSkillOverride !== '') {
    preferredOverride = normalizeSkillLevelText(opts.preferredSkillOverride);
  }

  const profile = profileQuery(q, {
    preferredSkill: preferredOverride,
    verbs: opts.verbs ?? [],
  });

  // Parallel: FTS âˆ¥ embed, then KNN
  const ftsPromise = Promise.resolve(opts.fts(q, recallK));
  const embedPromise = Promise.resolve(opts.embed());
  const [ftsHits, embedding] = await Promise.all([ftsPromise, embedPromise]);
  const intentHits = (await Promise.resolve(
    opts.knn(embedding, recallK),
  )) as Parameters<typeof collapseToCommands>[0];

  const collapsed = collapseToCommands(
    intentHits,
    ftsHits,
    profile.preferredSkill,
  );

  if (collapsed.length === 0) {
    return {
      status: 'empty',
      confidence: 0,
      results: [],
      displayResults: [],
      blend: { alpha: profile.alpha, beta: profile.beta },
      preferredSkill: profile.preferredSkill,
      query: q,
      alert: 'red',
    };
  }

  const cosineRaw = collapsed.map((c) =>
    c.rawCosine == null ? Number.NEGATIVE_INFINITY : c.rawCosine,
  );
  const bm25Raw = collapsed.map((c) =>
    c.rawBm25 == null ? Number.POSITIVE_INFINITY : c.rawBm25,
  );

  // Present channels only for min-max; absent â†’ 0 after
  const cosinePresentIdx = collapsed
    .map((c, i) => (c.rawCosine != null ? i : -1))
    .filter((i) => i >= 0);
  const bm25PresentIdx = collapsed
    .map((c, i) => (c.rawBm25 != null ? i : -1))
    .filter((i) => i >= 0);

  const cosNormAll = new Array(collapsed.length).fill(0);
  const bmNormAll = new Array(collapsed.length).fill(0);

  if (cosinePresentIdx.length) {
    const vals = cosinePresentIdx.map((i) => cosineRaw[i]!);
    const norms = minMaxNormalize(vals);
    cosinePresentIdx.forEach((i, j) => {
      cosNormAll[i] = norms[j]!;
    });
  }
  if (bm25PresentIdx.length) {
    const vals = bm25PresentIdx.map((i) => bm25Raw[i]!);
    const norms = normalizeBm25Batch(vals);
    bm25PresentIdx.forEach((i, j) => {
      bmNormAll[i] = norms[j]!;
    });
  }

  const scored = collapsed.map((c, i) => {
    const score = fuseScores(
      cosNormAll[i]!,
      bmNormAll[i]!,
      profile.alpha,
      profile.beta,
    );
    return {
      ...c,
      score,
      score_cosine: cosNormAll[i]!,
      score_bm25: bmNormAll[i]!,
      score_hybrid: score,
    };
  });

  scored.sort((a, b) =>
    tieBreak(
      {
        stepCount: a.stepCount,
        command_recipe_json: a.command_recipe_json,
        score: a.score,
        command_id: a.command_id,
      },
      {
        stepCount: b.stepCount,
        command_recipe_json: b.command_recipe_json,
        score: b.score,
        command_id: b.command_id,
      },
    ),
  );

  const ids = scored.map((s) => s.command_id);
  const hydrated = await Promise.resolve(opts.hydrate(ids));
  const byId = new Map(hydrated.map((h) => [Number(h.command_id), h]));

  const results: HybridHit[] = scored.map((s) => {
    const base = byId.get(s.command_id) ?? {
      command_id: s.command_id,
      commands: s.commands,
      example: s.example,
      snippet: s.snippet,
      risk: s.risk,
    };
    return {
      ...base,
      command_id: s.command_id,
      commands: base.commands?.length ? base.commands : s.commands,
      example: base.example || s.example,
      snippet: base.snippet || s.snippet,
      risk: base.risk ?? s.risk,
      skill_level: s.skill_level_text,
      intent_category: s.intent_category,
      intent_text: s.intent_text,
      score: s.score,
      score_cosine: s.score_cosine,
      score_bm25: s.score_bm25,
      score_hybrid: s.score_hybrid,
    };
  });

  const s1 = results[0]?.score ?? 0;
  // Gap vs first *distinct recipe* (evolved clones with same commands don't inflate C).
  const s2Distinct = nextDistinctRecipeScore(results);
  const s2 = s2Distinct != null ? s2Distinct : null;
  const confidence = computeConfidence(s1, s2);
  const uniqueRecipes = diversifyByRecipe(results, results.length);
  const gate = resolveDisplayCount(
    confidence,
    s1,
    s2,
    uniqueRecipes.length,
    thr,
  );
  const displayResults = diversifyByRecipe(results, gate.count);

  return {
    status: gate.count === 0 ? 'empty' : 'ok',
    confidence,
    results,
    displayResults,
    blend: { alpha: profile.alpha, beta: profile.beta },
    preferredSkill: profile.preferredSkill,
    query: q,
    alert: gate.alert,
  };
}
