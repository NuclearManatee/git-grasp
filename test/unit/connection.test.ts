// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { shouldAutoLoadPlayground } from '../../apps/web/src/lib/connection.js';

describe('shouldAutoLoadPlayground', () => {
  it('allows wifi ethernet other', () => {
    expect(shouldAutoLoadPlayground({ type: 'wifi' })).toBe(true);
    expect(shouldAutoLoadPlayground({ type: 'ethernet' })).toBe(true);
    expect(shouldAutoLoadPlayground({ type: 'other' })).toBe(true);
  });

  it('blocks cellular and saveData', () => {
    expect(shouldAutoLoadPlayground({ type: 'cellular' })).toBe(false);
    expect(shouldAutoLoadPlayground({ type: 'wifi', saveData: true })).toBe(false);
  });

  it('falls back to effectiveType when type missing', () => {
    expect(shouldAutoLoadPlayground({ effectiveType: '4g' })).toBe(true);
    expect(shouldAutoLoadPlayground({ effectiveType: '3g' })).toBe(false);
    expect(shouldAutoLoadPlayground(null)).toBe(false);
  });
});
