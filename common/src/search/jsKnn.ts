// @ts-nocheck
/**
 * Brute-force cosine KNN for web (no sqlite-vec).
 */

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom <= 0) return 0;
  return dot / denom;
}

export type VecRow = {
  id: string;
  embedding: Float32Array | number[];
  meta?: Record<string, unknown>;
};

/**
 * Top-k by cosine similarity (higher better). Returns distance = 1 - sim for hydrate parity.
 */
export function jsKnn(
  query: ArrayLike<number>,
  rows: VecRow[],
  k = 100,
): { id: string; distance: number; score: number; meta?: Record<string, unknown> }[] {
  const scored = rows.map((r) => {
    const score = cosineSimilarity(query, r.embedding);
    return {
      id: r.id,
      score,
      distance: 1 - score,
      meta: r.meta,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, k));
}
