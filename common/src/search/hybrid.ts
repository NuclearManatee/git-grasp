// @ts-nocheck
/**
 * Hybrid search: description KNN + BM25 FTS, fixed blend, no search-time LLM.
 */
import type { Thresholds } from '../schemas/thresholds.js';
import {
  computeConfidence,
  fuseScores,
  minMaxNormalize,
  normalizeBm25Batch,
  displayCountFromConfidence,
  diversifyByRecipe,
  nextDistinctRecipeScore,
  type DisplayGateEvidence,
} from './fusion.js';
import { applyPrimaryVerbBoost } from './verbBoost.js';
import { collapseToCommands } from './collapse.js';
import { DEFAULT_RECALL_K } from '../db/constants.js';

/** Fixed blend (skill profile parked). */
export const DEFAULT_ALPHA = 0.55;
export const DEFAULT_BETA = 0.45;

export type HybridHit = {
  command_id: string | number;
  commands: { command?: string; comment?: string }[];
  example: string;
  snippet: string;
  title?: string;
  description?: string;
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
  preferredSkill: string;
  query: string;
  alert?: 'none' | 'yellow' | 'orange' | 'red';
  gateEvidence?: DisplayGateEvidence;
};

export function normalizeQuery(query: string, enabled = true): string {
  if (!enabled) return String(query || '');
  return String(query || '').trim().replace(/\s+/g, ' ');
}

function tieBreak(a: {
  stepCount: number;
  command_recipe_json: string;
  score: number;
  command_id: string | number;
}, b: typeof a): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.stepCount !== b.stepCount) return a.stepCount - b.stepCount;
  const lex = a.command_recipe_json.localeCompare(b.command_recipe_json);
  if (lex !== 0) return lex;
  return String(a.command_id).localeCompare(String(b.command_id));
}

/**
 * Shared hybrid search core (CLI / web / eval).
 * Ports: embed, knn, fts, hydrate.
 */
export async function searchHybrid(opts: {
  query: string;
  thresholds: Thresholds;
  preferredSkillOverride?: string | number | null;
  verbs?: readonly string[];
  alpha?: number;
  beta?: number;
  embed: () => Promise<Float32Array | number[]>;
  knn: (
    vec: Float32Array | number[],
    k: number,
  ) => Promise<unknown[]> | unknown[];
  fts: (
    q: string,
    k: number,
  ) =>
    | Promise<{ command_id?: string | number; recipe_id?: string | number; bm25: number }[]>
    | { command_id?: string | number; recipe_id?: string | number; bm25: number }[];
  hydrate: (
    recipeIds: (string | number)[],
  ) => Promise<HybridHit[]> | HybridHit[];
}): Promise<SearchHybridResult> {
  const thr = opts.thresholds;
  const q = normalizeQuery(opts.query, thr.normalizeQuery !== false);
  const recallK = thr.recallK ?? DEFAULT_RECALL_K;
  void opts.preferredSkillOverride;

  const ftsPromise = Promise.resolve(opts.fts(q, recallK));
  const embedPromise = Promise.resolve(opts.embed());
  const [ftsHits, embedding] = await Promise.all([ftsPromise, embedPromise]);
  const knnHits = (await Promise.resolve(
    opts.knn(embedding, recallK),
  )) as Parameters<typeof collapseToCommands>[0];

  const collapsed = collapseToCommands(knnHits, ftsHits);

  if (collapsed.length === 0) {
    return {
      status: 'empty',
      confidence: 0,
      results: [],
      displayResults: [],
      blend: { alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA },
      preferredSkill: '',
      query: q,
      alert: 'red',
      gateEvidence: {
        topRawCosine: null,
        topHasBm25: false,
        topHasVerbBoost: false,
      },
    };
  }

  const cosineRaw = collapsed.map((c) =>
    c.rawCosine == null ? Number.NEGATIVE_INFINITY : c.rawCosine,
  );
  const bm25Raw = collapsed.map((c) =>
    c.rawBm25 == null ? Number.POSITIVE_INFINITY : c.rawBm25,
  );

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

  let alpha = opts.alpha ?? DEFAULT_ALPHA;
  let beta = opts.beta ?? DEFAULT_BETA;
  if (cosinePresentIdx.length && !bm25PresentIdx.length) {
    alpha = 1;
    beta = 0;
  } else if (!cosinePresentIdx.length && bm25PresentIdx.length) {
    alpha = 0;
    beta = 1;
  }

  const scored = collapsed.map((c, i) => {
    const score = fuseScores(cosNormAll[i]!, bmNormAll[i]!, alpha, beta);
    return {
      ...c,
      score,
      score_cosine: cosNormAll[i]!,
      score_bm25: bmNormAll[i]!,
      score_hybrid: score,
    };
  });

  const knownVerbs = (opts.verbs ?? []).map((v) =>
    String(v).replace(/^git\s+/i, '').toLowerCase(),
  );
  const boosted = applyPrimaryVerbBoost(scored, q, knownVerbs);

  boosted.sort((a, b) =>
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

  const ids = boosted.map((s) => s.command_id);
  const hydrated = await Promise.resolve(opts.hydrate(ids));
  const byId = new Map(hydrated.map((h) => [String(h.command_id), h]));

  const results: HybridHit[] = boosted.map((s) => {
    const base = byId.get(String(s.command_id)) ?? {
      command_id: s.command_id,
      commands: s.commands,
      example: s.example,
      snippet: s.snippet,
      title: s.title,
      description: s.description,
      risk: s.risk,
    };
    return {
      ...base,
      command_id: s.command_id,
      commands: base.commands?.length ? base.commands : s.commands,
      example: base.example || s.example,
      snippet: base.snippet || s.snippet,
      title: base.title || s.title || base.example || s.example,
      description:
        base.description || s.description || base.intent_text || s.intent_text || '',
      risk: base.risk ?? s.risk,
      skill_level: '',
      intent_category: '',
      intent_text: s.description || s.intent_text,
      score: s.score,
      score_cosine: s.score_cosine,
      score_bm25: s.score_bm25,
      score_hybrid: s.score_hybrid,
    };
  });

  const s1 = results[0]?.score ?? 0;
  const s2Distinct = nextDistinctRecipeScore(results);
  const s2 = s2Distinct != null ? s2Distinct : null;
  const confidence = computeConfidence(s1, s2);
  const uniqueRecipes = diversifyByRecipe(results, results.length);

  const top = boosted[0];
  const gateEvidence: DisplayGateEvidence = {
    topRawCosine: top?.rawCosine ?? null,
    topHasBm25: top?.rawBm25 != null,
    topHasVerbBoost: Number(top?.score_verb_boost ?? 0) > 0,
  };
  const gate = displayCountFromConfidence(
    confidence,
    s1,
    s2,
    uniqueRecipes.length,
    thr,
    gateEvidence,
  );
  const displayResults = diversifyByRecipe(results, gate.count);

  return {
    status: gate.count === 0 ? 'empty' : 'ok',
    confidence,
    results,
    displayResults,
    blend: { alpha, beta },
    preferredSkill: '',
    query: q,
    alert: gate.alert,
    gateEvidence,
  };
}
