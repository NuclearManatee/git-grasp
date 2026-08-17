// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import { stripAnsi, sanitizeField } from '../../common/src/lib/ansi.js';

describe('stripAnsi', () => {
  it('removes CSI colors', () => {
    expect(stripAnsi('\u001b[31mred\u001b[0m')).toBe('red');
  });
  it('removes OSC sequences', () => {
    expect(stripAnsi('\u001b]8;;http://x\u0007link\u001b]8;;\u0007')).toBe('link');
  });
  it('removes control chars', () => {
    expect(stripAnsi('a\u0000b\u0007c')).toBe('abc');
  });
});

describe('sanitizeField', () => {
  it('truncates', () => {
    expect(sanitizeField('x'.repeat(100), 10)).toHaveLength(10);
  });
});
