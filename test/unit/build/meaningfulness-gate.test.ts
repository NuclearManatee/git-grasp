// @ts-nocheck
import { describe, expect, test } from 'bun:test';

describe('meaningfulness gate', () => {
  test('rejects pass:false even with high score; rejects low score', async () => {
    // Inline the reject predicate used by recipeValidate (avoid full LLM/sandbox).
    function shouldReject(judge, minScore = 0.6) {
      return !judge.pass || (judge.score ?? 0) < minScore;
    }
    expect(shouldReject({ pass: false, score: 0.9 })).toBe(true);
    expect(shouldReject({ pass: true, score: 0.1 })).toBe(true);
    expect(shouldReject({ pass: true, score: 0.7 })).toBe(false);
  });
});
