import { describe, expect, it } from 'vitest';
import { cosineSimilarity, jsKnn } from '../../../packages/core/src/search/jsKnn.ts';

describe('jsKnn', () => {
  it('ranks identical vector first', () => {
    const q = new Float32Array([1, 0, 0]);
    const rows = [
      { id: 'a', embedding: new Float32Array([0, 1, 0]) },
      { id: 'b', embedding: new Float32Array([1, 0, 0]) },
      { id: 'c', embedding: new Float32Array([0.5, 0.5, 0]) },
    ];
    const hits = jsKnn(q, rows, 2);
    expect(hits[0].id).toBe('b');
    expect(hits[0].score).toBeCloseTo(1);
    expect(hits).toHaveLength(2);
  });

  it('cosineSimilarity symmetric', () => {
    const a = [1, 2, 3];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1);
  });
});
