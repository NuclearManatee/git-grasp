// @ts-nocheck
/**
 * Deterministic 80/20 holdout split by hash of final query.
 */
import { createHash } from 'node:crypto';

/**
 * @param {string} query
 * @returns {number} 0..1
 */
export function queryHashUnit(query) {
  const h = createHash('sha256').update(String(query || '')).digest();
  // first 4 bytes as uint32
  const n = h.readUInt32BE(0);
  return n / 0xffffffff;
}

/**
 * @param {import('./schemas.js').FeederItem[]} items
 * @param {{ holdoutRate?: number }} [opts]
 */
export function splitFeederHoldout(items, opts = {}) {
  const holdoutRate = opts.holdoutRate ?? 0.2;
  const train = [];
  const holdout = [];
  for (const item of items || []) {
    if (queryHashUnit(item.query) < holdoutRate) holdout.push(item);
    else train.push(item);
  }
  // If tiny sets land all in one bucket, rebalance lightly
  if (items.length >= 5 && (train.length === 0 || holdout.length === 0)) {
    const sorted = [...items].sort((a, b) => a.query.localeCompare(b.query));
    const cut = Math.max(1, Math.floor(sorted.length * holdoutRate));
    return { train: sorted.slice(cut), holdout: sorted.slice(0, cut) };
  }
  return { train, holdout };
}
