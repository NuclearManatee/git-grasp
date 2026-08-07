// @ts-nocheck
/**
 * Hybrid score normalization, fusion, confidence, and display cardinality.
 */
import {
  DISPLAY_ABSTAIN_COSINE_FLOOR,
  DISPLAY_GAP_EXACT,
  DISPLAY_GAP_NARROW,
} from '../db/constants.js';

export type DisplayGateThresholds = {
  topK?: number;
  confidenceVeryHigh: number;
  confidenceHigh: number;
  confidenceMedium: number;
  gapExact?: number;
  gapNarrow?: number;
  abstainCosineFloor?: number;
};

export type ConfidenceAlert = 'none' | 'yellow' | 'orange' | 'red';

export type DisplayCountResult = {
  count: number;
  alert: ConfidenceAlert;
};

/** Absolute-channel evidence for abstain (red) decisions. */
export type DisplayGateEvidence = {
  /** Top hit raw cosine similarity in [0,1], or null if channel absent. */
  topRawCosine: number | null;
  topHasBm25: boolean;
  topHasVerbBoost: boolean;
};

/** Normalize recipe steps for display diversity (ignore comments / initial_state). */
export function recipeFingerprint(hit: {
  commands?: { command?: string; run?: string }[];
  example?: string;
  command?: string;
}): string {
  const cmds = hit.commands;
  if (Array.isArray(cmds) && cmds.length) {
    return cmds
      .map((c) => String(c.command ?? c.run ?? '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('\n')
      .toLowerCase();
  }
  return String(hit.example || hit.command || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Pick up to `count` hits with unique recipe fingerprints (keeps rank order).
 */
export function diversifyByRecipe<T extends {
  commands?: { command?: string; run?: string }[];
  example?: string;
  command?: string;
}>(hits: T[], count: number): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (out.length >= count) break;
    const key = recipeFingerprint(h) || `__id_${out.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

/**
 * Score of the first hit whose recipe differs from the head (for confidence gap).
 * Returns null if no distinct runner-up.
 */
export function nextDistinctRecipeScore<T extends {
  score?: number;
  commands?: { command?: string; run?: string }[];
  example?: string;
  command?: string;
}>(hits: T[]): number | null {
  if (!hits.length) return null;
  const headKey = recipeFingerprint(hits[0]!);
  for (let i = 1; i < hits.length; i++) {
    if (recipeFingerprint(hits[i]!) !== headKey) {
      return typeof hits[i]!.score === 'number' ? hits[i]!.score! : null;
    }
  }
  return null;
}

/** Min-max normalize a batch to [0,1]. Equal values → all 1 (full channel credit). */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (span <= 0) return values.map(() => 1);
  return values.map((v) => (v - min) / span);
}

/**
 * SQLite FTS5 bm25() is more-negative = better.
 * Invert then min-max: S = (max - raw) / (max - min).
 * Equal / single-hit batches → 1 (do not zero the only evidence).
 */
export function normalizeBm25Batch(rawBm25: number[]): number[] {
  if (rawBm25.length === 0) return [];
  let min = rawBm25[0]!;
  let max = rawBm25[0]!;
  for (const v of rawBm25) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (span <= 0) return rawBm25.map(() => 1);
  return rawBm25.map((raw) => (max - raw) / span);
}

export function fuseScores(
  cosineNorm: number,
  bm25Norm: number,
  alpha: number,
  beta: number,
): number {
  return alpha * cosineNorm + beta * bm25Norm;
}

/**
 * C = min(1, S1 * (1 + max(0, S1 - S2))); missing S2 → gap 0 (C = S1).
 */
export function computeConfidence(s1: number, s2: number | null | undefined): number {
  if (s2 == null) return Math.min(1, Math.max(0, s1));
  const gap = Math.max(0, s1 - s2);
  return Math.min(1, s1 * (1 + gap));
}

/**
 * True when every absolute channel is weak (abstain candidate).
 * Omitted evidence → not weak (relative bands decide alone).
 */
export function weakAbsoluteEvidence(
  evidence: DisplayGateEvidence | null | undefined,
  floor: number,
): boolean {
  if (!evidence) return false;
  const cos = evidence.topRawCosine;
  const cosineWeak = cos == null || cos < floor;
  return cosineWeak && !evidence.topHasBm25 && !evidence.topHasVerbBoost;
}

/**
 * Map confidence C + gap + absolute evidence to display count + alert.
 *
 * Abstain (red/0): only when absolute evidence is weak on every channel.
 * Count 1/2/3: relative C bands, gated by fused-score gap to next distinct recipe.
 * Near-ties widen display; crowded ≠ absent.
 */
export function displayCountFromConfidence(
  confidence: number,
  s1: number,
  s2: number | null | undefined,
  available: number,
  thr: DisplayGateThresholds,
  evidence?: DisplayGateEvidence | null,
): DisplayCountResult {
  const topK = thr.topK ?? 3;
  const n = Math.max(0, available);
  if (n === 0) return { count: 0, alert: 'red' };

  const floor = thr.abstainCosineFloor ?? DISPLAY_ABSTAIN_COSINE_FLOOR;
  if (weakAbsoluteEvidence(evidence, floor)) {
    return { count: 0, alert: 'red' };
  }

  const gapExact = thr.gapExact ?? DISPLAY_GAP_EXACT;
  const gapNarrow = thr.gapNarrow ?? DISPLAY_GAP_NARROW;
  const gap = s2 == null ? 0 : Math.max(0, s1 - s2);
  const show = (count: number, alert: ConfidenceAlert): DisplayCountResult => ({
    count: Math.min(count, topK, 3, n),
    alert,
  });

  if (confidence > thr.confidenceVeryHigh && gap >= gapExact) {
    return show(1, 'none');
  }
  if (confidence > thr.confidenceHigh && gap >= gapNarrow) {
    return show(2, 'yellow');
  }
  // Below-medium / near-tie / sole hit: show alternatives (orange), never red
  // on relative signal alone.
  return show(Math.min(topK, 3), 'orange');
}

/** @deprecated use displayCountFromConfidence directly */
export function resolveDisplayCount(
  confidence: number,
  s1: number,
  s2: number | null | undefined,
  available: number,
  thr: DisplayGateThresholds,
  evidence?: DisplayGateEvidence | null,
): DisplayCountResult {
  return displayCountFromConfidence(confidence, s1, s2, available, thr, evidence);
}
