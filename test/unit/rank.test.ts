import { describe, it, expect } from 'vitest';
import { normalizeQuery } from '../../packages/core/src/search/hybrid.js';

describe('normalizeQuery', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeQuery('  undo   last  ', true)).toBe('undo last');
  });

  it('keeps flags', () => {
    expect(normalizeQuery('reset --hard', true)).toBe('reset --hard');
  });
});
