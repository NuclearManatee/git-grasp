// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import { gradeCase, migrateGoldenCase, normalizeSkillBand } from '../../common/src/eval/judge.js';

describe('gradeCase', () => {
  const base = {
    expectedCommand: 'git branch',
    expectedExample: 'git branch --show-current',
    acceptableCommands: ['git branch'],
    acceptableExamples: [
      'git branch --show-current',
      'git rev-parse --abbrev-ref HEAD',
    ],
    expectedSimplestExample: 'git branch --show-current',
    preferSimplest: true,
  };

  it('scores 5 for simplest', () => {
    const g = gradeCase(base, {
      command: 'git branch',
      example: 'git branch --show-current',
    });
    expect(g.score).toBe(5);
    expect(g.pass).toBe(true);
    expect(g.passAt5).toBe(true);
  });

  it('scores 4 for acceptable non-simplest when preferSimplest', () => {
    const g = gradeCase(base, {
      command: 'git rev-parse',
      example: 'git rev-parse --abbrev-ref HEAD',
    });
    expect(g.score).toBe(4);
    expect(g.pass).toBe(false);
    expect(g.passAt3).toBe(true);
    expect(g.passAt5).toBe(false);
  });

  it('scores 1 for wrong command', () => {
    const g = gradeCase(base, { command: 'git push', example: 'git push' });
    expect(g.score).toBe(1);
    expect(g.pass).toBe(false);
  });
});

describe('migrateGoldenCase', () => {
  it('materializes placeholders and clamps skill 5', () => {
    const m = migrateGoldenCase({
      id: 'x',
      query: 'q',
      expectedCommand: 'git add <file>',
      acceptableCommands: ['git add <file>'],
      expectedSkillBand: [2, 5],
    });
    expect(m.expectedExample).toContain('app.js');
    expect(m.expectedSkillBand[1]).toBe(4);
  });
});

describe('normalizeSkillBand', () => {
  it('accepts enum names', () => {
    expect(normalizeSkillBand(['non-technical', 'beginner'])).toEqual([1, 2]);
  });
});
