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
  weakAbsoluteEvidence,
} from '../../../common/src/search/fusion.ts';
import {
  DISPLAY_ABSTAIN_COSINE_FLOOR,
  DISPLAY_GAP_EXACT,
  DISPLAY_GAP_NARROW,
} from '../../../common/src/db/constants.ts';

const thr = {
  topK: 3,
  confidenceVeryHigh: 0.9,
  confidenceHigh: 0.75,
  confidenceMedium: 0.4,
  gapExact: DISPLAY_GAP_EXACT,
  gapNarrow: DISPLAY_GAP_NARROW,
  abstainCosineFloor: DISPLAY_ABSTAIN_COSINE_FLOOR,
};

/** Strong absolute evidence so relative-band tests are not red. */
const strongEvidence = {
  topRawCosine: 0.85,
  topHasBm25: true,
  topHasVerbBoost: false,
};

describe('minMaxNormalize', () => {
  it('maps min→0 max→1', () => {
    expect(minMaxNormalize([1, 3, 5])).toEqual([0, 0.5, 1]);
  });

  it('all equal → ones (full channel credit)', () => {
    expect(minMaxNormalize([2, 2, 2])).toEqual([1, 1, 1]);
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

  it('single or tied BM25 → ones', () => {
    expect(normalizeBm25Batch([-6])).toEqual([1]);
    expect(normalizeBm25Batch([-3, -3])).toEqual([1, 1]);
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

  it('treats missing S2 as gap 0 (C = S1, no inflation)', () => {
    const c = computeConfidence(0.5, null);
    expect(c).toBeCloseTo(0.5);
  });

  it('treats undefined S2 as gap 0', () => {
    expect(computeConfidence(0.8, undefined)).toBeCloseTo(0.8);
  });
});

describe('weakAbsoluteEvidence', () => {
  it('true only when every channel is weak', () => {
    expect(
      weakAbsoluteEvidence(
        { topRawCosine: 0.4, topHasBm25: false, topHasVerbBoost: false },
        0.6,
      ),
    ).toBe(true);
  });

  it('false when cosine meets floor', () => {
    expect(
      weakAbsoluteEvidence(
        { topRawCosine: 0.7, topHasBm25: false, topHasVerbBoost: false },
        0.6,
      ),
    ).toBe(false);
  });

  it('false when BM25 present', () => {
    expect(
      weakAbsoluteEvidence(
        { topRawCosine: 0.3, topHasBm25: true, topHasVerbBoost: false },
        0.6,
      ),
    ).toBe(false);
  });

  it('false when verb boost present', () => {
    expect(
      weakAbsoluteEvidence(
        { topRawCosine: 0.3, topHasBm25: false, topHasVerbBoost: true },
        0.6,
      ),
    ).toBe(false);
  });

  it('false when evidence omitted', () => {
    expect(weakAbsoluteEvidence(undefined, 0.6)).toBe(false);
  });
});

describe('displayCountFromConfidence bands', () => {
  it('very high C + gapExact → 1, no alert', () => {
    expect(
      displayCountFromConfidence(0.95, 0.95, 0.7, 5, thr, strongEvidence),
    ).toEqual({ count: 1, alert: 'none' });
  });

  it('high C + gapNarrow → 2, yellow', () => {
    // C = 0.8*(1+0.1)=0.88 → high band; gap=0.1 ≥ gapNarrow
    expect(
      displayCountFromConfidence(0.88, 0.8, 0.7, 5, thr, strongEvidence),
    ).toEqual({ count: 2, alert: 'yellow' });
  });

  it('medium C → 3, orange', () => {
    expect(
      displayCountFromConfidence(0.5, 0.5, 0.4, 5, thr, strongEvidence),
    ).toEqual({ count: 3, alert: 'orange' });
  });

  it('low C without weak evidence → 3 orange (never red on relative alone)', () => {
    expect(
      displayCountFromConfidence(0.3, 0.3, 0.2, 5, thr, strongEvidence),
    ).toEqual({ count: 3, alert: 'orange' });
  });

  it('low C with no evidence passed → 3 orange', () => {
    expect(displayCountFromConfidence(0.3, 0.3, 0.2, 5, thr)).toEqual({
      count: 3,
      alert: 'orange',
    });
  });

  it('full tie (C=1, gap=0) → 3 orange, not exact', () => {
    expect(
      displayCountFromConfidence(1, 1, 1, 5, thr, strongEvidence),
    ).toEqual({ count: 3, alert: 'orange' });
  });

  it('high C with gap < gapNarrow → 3 orange', () => {
    // s1=0.9, s2=0.88, gap=0.02 < 0.05; C = min(1, 0.9*1.02)=0.918
    expect(
      displayCountFromConfidence(0.918, 0.9, 0.88, 5, thr, strongEvidence),
    ).toEqual({ count: 3, alert: 'orange' });
  });

  it('very high C with gapExact → 1 none', () => {
    expect(
      displayCountFromConfidence(0.95, 0.9, 0.7, 5, thr, strongEvidence),
    ).toEqual({ count: 1, alert: 'none' });
  });

  it('weak absolute evidence → 0 red', () => {
    expect(
      displayCountFromConfidence(0.95, 0.9, 0.2, 5, thr, {
        topRawCosine: 0.4,
        topHasBm25: false,
        topHasVerbBoost: false,
      }),
    ).toEqual({ count: 0, alert: 'red' });
  });

  it('weak cosine but BM25 present → not red', () => {
    const r = displayCountFromConfidence(0.95, 0.9, 0.7, 5, thr, {
      topRawCosine: 0.4,
      topHasBm25: true,
      topHasVerbBoost: false,
    });
    expect(r.alert).not.toBe('red');
    expect(r.count).toBeGreaterThan(0);
  });

  it('weak cosine but verb boost → not red', () => {
    const r = displayCountFromConfidence(0.95, 0.9, 0.7, 5, thr, {
      topRawCosine: 0.4,
      topHasBm25: false,
      topHasVerbBoost: true,
    });
    expect(r.alert).not.toBe('red');
    expect(r.count).toBeGreaterThan(0);
  });

  it('available === 0 → red', () => {
    expect(
      displayCountFromConfidence(0.95, 0.9, 0.2, 0, thr, strongEvidence),
    ).toEqual({ count: 0, alert: 'red' });
  });

  it('never pads beyond available', () => {
    expect(
      displayCountFromConfidence(0.88, 0.8, 0.7, 1, thr, strongEvidence),
    ).toEqual({ count: 1, alert: 'yellow' });
  });

  it('sole distinct recipe (missing S2) with strong evidence → show up to available', () => {
    // C = S1 = 0.8 (no inflation); gap treated as 0 → not exact band
    const r = displayCountFromConfidence(0.8, 0.8, null, 1, thr, strongEvidence);
    expect(r.count).toBe(1);
    expect(r.alert).not.toBe('red');
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
