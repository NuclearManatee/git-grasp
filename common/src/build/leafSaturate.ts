// @ts-nocheck
/**
 * Per-leaf discovery-curve saturation.
 */
import {
  DISCOVERY_FLAT_BATCHES,
  DISCOVERY_MIN_NEW_RATE,
} from '../db/constants.js';
import { generateLeafBatch } from './leafGenerate.js';

/**
 * @param {number} distinctNew
 * @param {number} batchSize
 * @param {number} [minRate]
 */
export function isDiscoveryBatchFlat(distinctNew, batchSize, minRate = DISCOVERY_MIN_NEW_RATE) {
  if (!batchSize || batchSize <= 0) return true;
  return distinctNew / batchSize < minRate;
}

/**
 * Run generation batches until discovery flattens for N consecutive batches.
 */
export async function saturateLeaf(leaf, opts = {}) {
  const flatNeed = opts.flatBatches ?? DISCOVERY_FLAT_BATCHES;
  const maxBatches = opts.maxBatches ?? 50;
  let flatStreak = 0;
  const history = [];
  let totalAccepted = 0;

  for (let i = 0; i < maxBatches; i += 1) {
    const batch = await generateLeafBatch(leaf, opts);
    const flat = isDiscoveryBatchFlat(batch.distinctNew, batch.batchSize || 1);
    history.push({
      batch: i + 1,
      distinctNew: batch.distinctNew,
      batchSize: batch.batchSize,
      flat,
      rejected: batch.rejected.length,
    });
    totalAccepted += batch.accepted.length;
    if (flat) flatStreak += 1;
    else flatStreak = 0;
    if (flat) flatStreak += 1;
    else flatStreak = 0;
    if (flatStreak >= flatNeed) {
      // Vacuous flat (zero accepts) is not a successful discovery checkpoint.
      const checkpoint = totalAccepted > 0;
      return {
        ok: checkpoint,
        checkpoint,
        flatStreak,
        totalAccepted,
        history,
        reason: checkpoint ? undefined : 'zero_accepts',
      };
    }
  }

  return {
    ok: false,
    checkpoint: false,
    flatStreak,
    totalAccepted,
    history,
    reason: 'max_batches',
  };
}
