import { describe, it, expect } from 'vitest';
import { buildProgram } from '../../src/cli/program.js';

describe('CLI program', () => {
  it('builds without throw', () => {
    const p = buildProgram();
    expect(p.name()).toBe('git-help');
  });
});
