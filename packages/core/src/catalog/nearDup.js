import { cosineSimilarity } from '../db/utils.js';

/**
 * Filter candidate intent strings that are too similar to already-accepted ones.
 * Uses mock/real embeddings via embedFn(text) => Float32Array|number[].
 *
 * @param {string[]} candidates
 * @param {{
 *   embedFn: (text: string) => Promise<Float32Array|number[]> | Float32Array|number[],
 *   existing?: string[],
 *   maxCosine?: number,
 * }} opts
 * @returns {Promise<string[]>}
 */
export async function filterNearDuplicateIntents(candidates, {
  embedFn,
  existing = [],
  maxCosine = 0.92,
} = {}) {
  if (!embedFn) throw new Error('embedFn required');
  const accepted = [];
  const acceptedEmb = [];

  for (const text of existing) {
    const e = await embedFn(text);
    accepted.push(text);
    acceptedEmb.push(e instanceof Float32Array ? e : new Float32Array(e));
  }

  const kept = [];
  for (const text of candidates) {
    const trimmed = String(text || '').trim();
    if (!trimmed) continue;
    // Exact / case-insensitive dup
    if (accepted.some((a) => a.toLowerCase() === trimmed.toLowerCase())) continue;

    const emb = await embedFn(trimmed);
    const vec = emb instanceof Float32Array ? emb : new Float32Array(emb);
    let tooClose = false;
    for (const other of acceptedEmb) {
      if (cosineSimilarity(vec, other) >= maxCosine) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    accepted.push(trimmed);
    acceptedEmb.push(vec);
    kept.push(trimmed);
  }
  return kept;
}
