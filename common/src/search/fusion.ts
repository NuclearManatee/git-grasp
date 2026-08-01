// @ts-nocheck
/**
 * Hybrid score normalization, fusion, confidence, and display cardinality.
 */

export type DisplayGateThresholds = {
  topK?: number;
  confidenceVeryHigh: number;
  confidenceHigh: number;
  confidenceMedium: number;
};

export type ConfidenceAlert = 'none' | 'yellow' | 'orange' | 'red';

export type DisplayCountResult = {
  count: number;
  alert: ConfidenceAlert;
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

/** Min-max normalize a batch to [0,1]. Equal values â†’ all 0. */
export function minMaxNormalize(values: number[]): number[] {
  if (values.length === 0) return [];
  let min = values[0]!;
  let max = values[0]!;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min;
  if (span <= 0) return values.map(() => 0);
  return values.map((v) => (v - min) / span);
}

/**
 * SQLite FTS5 bm25() is more-negative = better.
 * Invert then min-max: S = (max - raw) / (max - min).
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
  if (span <= 0) return rawBm25.map(() => 0);
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
 * C = min(1, S1 * (1 + max(0, S1 - S2))); missing S2 â‡’ 0.
 */
export function computeConfidence(s1: number, s2: number | null | undefined): number {
  const second = s2 == null ? 0 : s2;
  const gap = Math.max(0, s1 - second);
  return Math.min(1, s1 * (1 + gap));
}

/**
 * Map confidence C to display count + alert.
 *
 * - C > veryHigh (0.9) â†’ 1 result, no alert (exact)
 * - C > high (0.75)    â†’ 2 results, yellow
 * - C > medium (0.4)   â†’ 3 results, orange
 * - else               â†’ 0 results, red
 */
export function displayCountFromConfidence(
  confidence: number,
  _s1: number,
  _s2: number | null | undefined,
  available: number,
  thr: DisplayGateThresholds,
): DisplayCountResult {
  const topK = thr.topK ?? 3;
  const n = Math.max(0, available);
  if (n === 0) return { count: 0, alert: 'red' };

  if (confidence > thr.confidenceVeryHigh) {
    return { count: Math.min(1, n), alert: 'none' };
  }
  if (confidence > thr.confidenceHigh) {
    return { count: Math.min(2, n), alert: 'yellow' };
  }
  if (confidence > thr.confidenceMedium) {
    return { count: Math.min(topK, 3, n), alert: 'orange' };
  }
  return { count: 0, alert: 'red' };
}

/** @deprecated use displayCountFromConfidence directly */
export function resolveDisplayCount(
  confidence: number,
  s1: number,
  s2: number | null | undefined,
  available: number,
  thr: DisplayGateThresholds,
): DisplayCountResult {
  return displayCountFromConfidence(confidence, s1, s2, available, thr);
}
