// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import {
  saturateLeaf,
  isDiscoveryBatchFlat,
} from '../../../common/src/build/leafSaturate.ts';

const leaf = {
  id: 'leaf-a',
  name: 'A',
  description: 'd',
  mapped_commands: ['git status'],
};

function batch({ accepted = 0, distinctNew = 0, batchSize = 4 } = {}) {
  return {
    accepted: Array.from({ length: accepted }, (_, i) => ({ id: `r${i}` })),
    rejected: [],
    distinctNew,
    batchSize,
  };
}

describe('saturateLeaf discovery', () => {
  test('isDiscoveryBatchFlat', () => {
    expect(isDiscoveryBatchFlat(0, 8)).toBe(true);
    expect(isDiscoveryBatchFlat(4, 8)).toBe(false);
  });

  test('requires N consecutive flats after accepts', async () => {
    const seq = [
      batch({ accepted: 2, distinctNew: 2 }), // not flat
      batch({ accepted: 1, distinctNew: 0 }), // flat 1
      batch({ accepted: 1, distinctNew: 0 }), // flat 2 → stop
    ];
    let i = 0;
    const out = await saturateLeaf(leaf, {
      flatBatches: 2,
      maxBatches: 10,
      generateLeafBatch: async () => seq[i++] || batch({ accepted: 0, distinctNew: 0 }),
    });
    expect(out.ok).toBe(true);
    expect(out.checkpoint).toBe(true);
    expect(out.flatStreak).toBe(2);
    expect(out.history.length).toBe(3);
  });

  test('zero-accept flat batches do not early-checkpoint', async () => {
    let calls = 0;
    const out = await saturateLeaf(leaf, {
      flatBatches: 2,
      maxBatches: 5,
      generateLeafBatch: async () => {
        calls += 1;
        return batch({ accepted: 0, distinctNew: 0 });
      },
    });
    expect(calls).toBe(5);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('zero_accepts');
    expect(out.checkpoint).toBe(false);
  });

  test('max_batches when never flat enough', async () => {
    const out = await saturateLeaf(leaf, {
      flatBatches: 2,
      maxBatches: 3,
      generateLeafBatch: async () => batch({ accepted: 1, distinctNew: 2 }),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('max_batches');
    expect(out.totalAccepted).toBe(3);
  });
});
