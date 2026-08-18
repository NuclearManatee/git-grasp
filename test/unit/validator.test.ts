// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import {
  validateCommand,
  validateIntentRow,
  validateExample,
  validateRecipe,
  validateSearchIntent,
  makeRowId,
  makeIntentId,
  recipeSlugFromTitle,
  commandSlug,
  normalizeExample,
} from '../../common/src/lib/validator.js';
import {
  parseSkillLevel,
  skillName,
  skillAtMost,
  isValidSkillLevel,
  coerceSkillBandValue,
  skillPromptList,
  normalizeSkillLevelText,
  SKILL_MAX,
} from '../../common/src/lib/skills.js';

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
    // curly double quotes U+201C / U+201D
    expect(normalizeExample(`git commit -m \u201cFix\u201d`)).toBe('git commit -m "Fix"');
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
    expect(makeIntentId('rec', 3, 2)).toBe('rec:3:2');
    expect(recipeSlugFromTitle('Show Status')).toBe('show-status');
    expect(recipeSlugFromTitle('')).toBe('recipe');
    expect(commandSlug('Git Status')).toBe('git-status');
  });
});

describe('validateRecipe / validateSearchIntent', () => {
  it('delegates to zod helpers', () => {
    expect(validateRecipe({ id: 'r', title: 'Status', commands: [{ command: 'git status' }] }).ok).toBe(
      true,
    );
    expect(
      validateSearchIntent({
        id: 'i',
        recipe_id: 'r',
        intent_text: 'show status',
        skill_level: 2,
      }).ok,
    ).toBe(true);
  });
});

describe('skills', () => {
  it('parses names and ints', () => {
    expect(parseSkillLevel('beginner')).toBe(2);
    expect(parseSkillLevel('4')).toBe(4);
    expect(parseSkillLevel('clear')).toBe(null);
    expect(skillName(1)).toBe('nontechnical');
    expect(SKILL_MAX).toBe(4);
  });
  it('at-most filter', () => {
    expect(skillAtMost(1, 2)).toBe(true);
    expect(skillAtMost(3, 2)).toBe(false);
    expect(skillAtMost(4, null)).toBe(true);
    expect(skillAtMost('beginner', 'expert')).toBe(true);
    expect(isValidSkillLevel(3)).toBe(true);
    expect(isValidSkillLevel('nope')).toBe(false);
    expect(isValidSkillLevel('beginner')).toBe(true);
    expect(coerceSkillBandValue(5)).toBe(4);
    expect(coerceSkillBandValue('intermediate')).toBe(3);
    expect(() => coerceSkillBandValue(9)).toThrow();
    expect(() => coerceSkillBandValue('clear')).toThrow();
    expect(skillPromptList()).toContain('beginner');
    expect(normalizeSkillLevelText('non-technical')).toBe('nontechnical');
    expect(skillName('nope')).toBe('nope');
    expect(skillName(99)).toBe('99');
  });
});
