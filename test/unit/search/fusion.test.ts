import { describe, expect, it } from 'vitest';
import {
  computeConfidence,
  displayCountFromConfidence,
  diversifyByRecipe,
  fuseScores,
  minMaxNormalize,
  normalizeBm25Batch,
  nextDistinctRecipeScore,
  recipeFingerprint,
} from '../../../packages/core/src/search/fusion.ts';

const thr = {
  topK: 3,
  confidenceVeryHigh: 0.9,
  confidenceHigh: 0.75,
  confidenceMedium: 0.4,
};

describe('minMaxNormalize', () => {
  it('maps min→0 max→1', () => {
    expect(minMaxNormalize([1, 3, 5])).toEqual([0, 0.5, 1]);
  });

  it('all equal → zeros', () => {
    expect(minMaxNormalize([2, 2, 2])).toEqual([0, 0, 0]);
  });
});

describe('normalizeBm25Batch', () => {
  it('inverts SQLite BM25 (more negative = better)', () => {
    const n = normalizeBm25Batch([-10, -5, -1]);
    expect(n[0]).toBeCloseTo(1);
    expect(n[2]).toBeCloseTo(0);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[1]).toBeLessThan(1);
  });
});

describe('fuseScores', () => {
  it('applies α/β', () => {
    expect(fuseScores(1, 0, 0.7, 0.3)).toBeCloseTo(0.7);
    expect(fuseScores(0, 1, 0.3, 0.7)).toBeCloseTo(0.7);
  });
});

describe('computeConfidence', () => {
  it('rewards large gap', () => {
    const c = computeConfidence(0.9, 0.3);
    expect(c).toBeCloseTo(Math.min(1, 0.9 * (1 + 0.6)));
  });

  it('penalizes tiny gap', () => {
    const c = computeConfidence(0.6, 0.58);
    expect(c).toBeCloseTo(0.6 * (1 + 0.02));
  });

  it('treats missing S2 as 0', () => {
    const c = computeConfidence(0.5, null);
    expect(c).toBeCloseTo(Math.min(1, 0.5 * (1 + 0.5)));
  });
});

describe('displayCountFromConfidence bands', () => {
  it('very high C → 1, no alert', () => {
    expect(displayCountFromConfidence(0.95, 0.9, 0.2, 5, thr)).toEqual({
      count: 1,
      alert: 'none',
    });
  });

  it('high C → 2, yellow', () => {
    expect(displayCountFromConfidence(0.8, 0.7, 0.3, 5, thr)).toEqual({
      count: 2,
      alert: 'yellow',
    });
  });

  it('medium C → 3, orange', () => {
    expect(displayCountFromConfidence(0.5, 0.5, 0.4, 5, thr)).toEqual({
      count: 3,
      alert: 'orange',
    });
  });

  it('low C → 0, red', () => {
    expect(displayCountFromConfidence(0.3, 0.3, 0.2, 5, thr)).toEqual({
      count: 0,
      alert: 'red',
    });
  });

  it('never pads beyond available', () => {
    expect(displayCountFromConfidence(0.8, 0.7, 0.2, 1, thr)).toEqual({
      count: 1,
      alert: 'yellow',
    });
  });
});

describe('recipe diversity', () => {
  it('fingerprints by command steps only', () => {
    expect(
      recipeFingerprint({
        commands: [{ command: 'git blame file.txt', comment: 'a' }],
      }),
    ).toBe(
      recipeFingerprint({
        commands: [{ command: 'git blame file.txt', comment: 'b' }],
      }),
    );
  });

  it('diversifyByRecipe skips duplicate recipes', () => {
    const hits = [
      { command_id: 1, example: 'git blame file.txt', commands: [{ command: 'git blame file.txt' }], score: 0.9 },
      { command_id: 2, example: 'git blame file.txt', commands: [{ command: 'git blame file.txt' }], score: 0.8 },
      { command_id: 3, example: 'git log -p', commands: [{ command: 'git log -p' }], score: 0.5 },
    ];
    const out = diversifyByRecipe(hits, 3);
    expect(out.map((h) => h.command_id)).toEqual([1, 3]);
  });

  it('nextDistinctRecipeScore skips clones', () => {
    const hits = [
      { score: 0.7, commands: [{ command: 'git blame file.txt' }] },
      { score: 0.58, commands: [{ command: 'git blame file.txt' }] },
      { score: 0.4, commands: [{ command: 'git log' }] },
    ];
    expect(nextDistinctRecipeScore(hits)).toBe(0.4);
  });
});
