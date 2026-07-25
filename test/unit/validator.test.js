import { describe, it, expect } from 'vitest';
import {
  validateCommand,
  validateIntentRow,
  validateExample,
  makeRowId,
  normalizeExample,
} from '../../src/lib/validator.js';
import {
  parseSkillLevel,
  skillName,
  skillAtMost,
  SKILL_MAX,
} from '../../src/lib/skills.js';

describe('validateCommand', () => {
  it('accepts porcelain', () => {
    expect(validateCommand('git reset --soft HEAD~1').ok).toBe(true);
  });
  it('rejects shell metacharacters', () => {
    expect(validateCommand('git status && curl evil').reason).toBe('shell_meta');
    expect(validateCommand('git show $(whoami)').reason).toBe('shell_meta');
  });
  it('rejects non-git', () => {
    expect(validateCommand('rm -rf /').reason).toBe('allowlist');
  });
});

describe('validateExample', () => {
  it('rejects placeholders', () => {
    expect(validateExample('git add <file>').reason).toBe('placeholder');
  });
  it('accepts concrete examples', () => {
    expect(validateExample('git add app.js').ok).toBe(true);
  });
});

describe('normalizeExample E4', () => {
  it('collapses whitespace and quotes', () => {
    expect(normalizeExample('  git  status  -sb ')).toBe('git status -sb');
    expect(normalizeExample('git commit -m “Fix”')).toBe('git commit -m "Fix"');
  });
});

describe('validateIntentRow', () => {
  it('checks skill 1-4', () => {
    expect(validateIntentRow({
      command: 'git status',
      example: 'git status',
      skill_level: 9,
      intent_description: 'x',
    }).ok).toBe(false);
    expect(validateIntentRow({
      command: 'git status',
      example: 'git status',
      skill_level: 4,
      intent_description: 'x',
    }).ok).toBe(true);
  });
});

describe('makeRowId', () => {
  it('includes skill and intent index', () => {
    expect(makeRowId('git reset --soft HEAD~1', 2, 1)).toBe('git-reset-soft-head-1:2:1');
  });
});

describe('skills', () => {
  it('parses names and ints', () => {
    expect(parseSkillLevel('beginner')).toBe(2);
    expect(parseSkillLevel('4')).toBe(4);
    expect(parseSkillLevel('clear')).toBe(null);
    expect(skillName(1)).toBe('non-technical');
    expect(SKILL_MAX).toBe(4);
  });
  it('at-most filter', () => {
    expect(skillAtMost(1, 2)).toBe(true);
    expect(skillAtMost(3, 2)).toBe(false);
    expect(skillAtMost(4, null)).toBe(true);
  });
});
