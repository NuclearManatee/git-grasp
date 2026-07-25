import { describe, it, expect } from 'vitest';
import { validateCommand, validateIntentRow, makeRowId } from '../../src/lib/validator.js';

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

describe('validateIntentRow', () => {
  it('checks skill', () => {
    expect(validateIntentRow({
      command: 'git status',
      skill_level: 9,
      intent_description: 'x',
    }).ok).toBe(false);
  });
});

describe('makeRowId', () => {
  it('stable slug', () => {
    expect(makeRowId('git reset --soft HEAD~1', 2)).toBe('git-reset-soft-head-1:2');
  });
});
