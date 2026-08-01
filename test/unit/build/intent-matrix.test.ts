import { describe, expect, it } from 'vitest';
import {
  IntentMatrixFileSchema,
  allCellKeys,
  formatIntentMatrixForPrompt,
  cellKey,
} from '../../../common/src/schemas/intentMatrix.ts';
import { readFileSync } from 'node:fs';
import { intentMatrixPath } from '../../../common/src/lib/paths.ts';

describe('intent matrix schema', () => {
  it('accepts shipped matrix with all 16 cells', () => {
    const raw = JSON.parse(readFileSync(intentMatrixPath(), 'utf8'));
    const parsed = IntentMatrixFileSchema.parse(raw);
    expect(parsed.cells).toHaveLength(16);
    expect(allCellKeys()).toHaveLength(16);
    expect(formatIntentMatrixForPrompt(parsed)).toMatch(/nontechnical/);
  });

  it('rejects duplicate cells', () => {
    const cell = {
      skill_level: 'beginner',
      intent_category: 'goal',
      description: 'x',
      dos: ['a'],
      donts: ['b'],
    };
    expect(() =>
      IntentMatrixFileSchema.parse({
        version: 1,
        cells: Array.from({ length: 16 }, () => cell),
      }),
    ).toThrow();
  });

  it('cellKey is stable', () => {
    expect(cellKey('expert', 'symptom')).toBe('expert::symptom');
  });
});
