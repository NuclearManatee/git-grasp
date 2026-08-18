import { describe, expect, it } from 'bun:test';
import {
  normalizeUsage,
  cosineSimilarity,
  distanceToSimilarity,
} from '../../common/src/db/utils.ts';

describe('db/utils', () => {
  it('normalizes usage objects and strings', () => {
    expect(normalizeUsage({ command_line: 'git status', blurb: 'show tree' })).toBe(
      'git status\nshow tree',
    );
    expect(normalizeUsage({ command_line: 'git status' })).toBe('git status');
    expect(normalizeUsage('git log')).toBe('git log');
    expect(normalizeUsage(null, 'git diff')).toBe('git diff');
    expect(normalizeUsage(null)).toBe('');
  });

  it('computes cosine similarity and distance mapping', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(distanceToSimilarity(0)).toBe(1);
    expect(distanceToSimilarity(1)).toBe(0);
    expect(distanceToSimilarity(Number.NaN)).toBe(0);
  });
});
