// @ts-nocheck
/**
 * Embedding similarity helpers for iterative intent expand.
 */
import { cosineSimilarity, distanceToSimilarity } from '../db/utils.js';
import {
  INTENT_FOREIGN_COSINE,
  INTENT_FOREIGN_KNN_K,
  INTENT_WITHIN_COSINE,
} from '../db/constants.js';

/**
 * @typedef {{ command_id: number | null | undefined, intent_text: string, similarity: number }} ForeignNeighbor
 * @typedef {{ intent_text: string, embedding: Float32Array | number[] }} EmbeddedIntent
 */

export { cosineSimilarity, distanceToSimilarity };

/**
 * True if candidate is a near-dup of any keeper at cosine >= threshold.
 * @param {Float32Array | number[]} candidateEmb
 * @param {EmbeddedIntent[]} keepers
 * @param {number} [threshold]
 * @returns {{ dup: boolean, similarity: number, index: number }}
 */
export function findWithinNearDup(candidateEmb, keepers, threshold = INTENT_WITHIN_COSINE) {
  let best = { dup: false, similarity: -1, index: -1 };
  for (let i = 0; i < (keepers || []).length; i += 1) {
    const sim = cosineSimilarity(candidateEmb, keepers[i].embedding);
    if (sim >= threshold && sim > best.similarity) {
      best = { dup: true, similarity: sim, index: i };
    }
  }
  return best;
}

/**
 * Keep first of each near-dup cluster within a batch (stable order).
 * @param {{ intent_text: string, embedding: Float32Array | number[], [k: string]: unknown }[]} items
 * @param {number} [threshold]
 */
export function dedupeBatchByCosine(items, threshold = INTENT_WITHIN_COSINE) {
  /** @type {typeof items} */
  const kept = [];
  for (const item of items || []) {
    const hit = findWithinNearDup(item.embedding, kept, threshold);
    if (hit.dup) continue;
    kept.push(item);
  }
  return kept;
}

/**
 * Normalize a lone id, array, or Set into an exclusion Set.
 * @param {number | null | undefined | Set<number> | number[]} value
 * @returns {Set<number>}
 */
export function normalizeExcludeIds(value) {
  /** @type {Set<number>} */
  const out = new Set();
  if (value == null) return out;
  if (value instanceof Set) {
    for (const v of value) {
      const n = Number(v);
      if (Number.isFinite(n)) out.add(n);
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = Number(v);
      if (Number.isFinite(n)) out.add(n);
    }
    return out;
  }
  const n = Number(value);
  if (Number.isFinite(n)) out.add(n);
  return out;
}

/**
 * Classify a neighbor hit as a foreign collision (other command_id).
 * Same command_id / ids in the exclude set are ignored.
 * @param {{ command_id?: number | null, intent_text?: string, similarity?: number, _forcedScore?: number, score?: number }} hit
 * @param {number | null | undefined | Set<number> | number[]} selfCommandIdOrExclude
 * @param {number} [threshold]
 * @returns {{ collision: boolean, neighbor: ForeignNeighbor | null }}
 */
export function classifyForeignHit(
  hit,
  selfCommandIdOrExclude,
  threshold = INTENT_FOREIGN_COSINE,
) {
  if (!hit) return { collision: false, neighbor: null };
  const cid = hit.command_id == null ? null : Number(hit.command_id);
  const excluded = normalizeExcludeIds(selfCommandIdOrExclude);
  if (cid != null && Number.isFinite(cid) && excluded.has(cid)) {
    return { collision: false, neighbor: null };
  }
  if (cid == null || !Number.isFinite(cid)) {
    return { collision: false, neighbor: null };
  }
  const similarity =
    typeof hit.similarity === 'number'
      ? hit.similarity
      : typeof hit._forcedScore === 'number'
        ? hit._forcedScore
        : typeof hit.score === 'number'
          ? hit.score
          : 0;
  if (similarity < threshold) return { collision: false, neighbor: null };
  return {
    collision: true,
    neighbor: {
      command_id: cid,
      intent_text: String(hit.intent_text || hit.intent_description || ''),
      similarity,
    },
  };
}

/**
 * Scan knnForeign results for first foreign collision.
 * @param {ForeignNeighbor[] | object[]} hits
 * @param {number | null | undefined | Set<number> | number[]} selfCommandIdOrExclude
 * @param {number} [threshold]
 */
export function findForeignCollision(
  hits,
  selfCommandIdOrExclude,
  threshold = INTENT_FOREIGN_COSINE,
) {
  for (const hit of hits || []) {
    const r = classifyForeignHit(hit, selfCommandIdOrExclude, threshold);
    if (r.collision) return r;
  }
  return { collision: false, neighbor: null };
}

/**
 * Map knnRecall hydrate hits → ForeignNeighbor list.
 * @param {object[]} knnHits
 */
export function knnHitsToForeignNeighbors(knnHits) {
  return (knnHits || []).map((h) => ({
    command_id: h.command_id == null ? null : Number(h.command_id),
    intent_text: String(h.intent_description || h.intent_text || ''),
    similarity:
      typeof h._forcedScore === 'number'
        ? h._forcedScore
        : typeof h.similarity === 'number'
          ? h.similarity
          : distanceToSimilarity(h._vecDistance ?? h.distance),
  }));
}

/**
 * Build a knnForeign adapter from a db + knnRecall fn.
 * @param {object} db
 * @param {(db: object, emb: Float32Array | number[], k: number) => object[]} knnRecallFn
 * @param {number} [k]
 */
export function makeKnnForeign(db, knnRecallFn, k = INTENT_FOREIGN_KNN_K) {
  return (embedding) => {
    const hits = knnRecallFn(db, embedding, k) || [];
    return knnHitsToForeignNeighbors(hits);
  };
}
