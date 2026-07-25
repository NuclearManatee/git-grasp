import { describe, it, expect } from 'bun:test';
import { buildProgram } from '../../apps/cli/src/program.js';

describe('CLI program', () => {
  it('builds without throw', () => {
    const p = buildProgram();
    expect(p.name()).toBe('git-help');
  });
});
