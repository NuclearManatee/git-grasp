import { describe, it, expect } from 'vitest';
import { formatSearchResult, primaryCommand } from '../../src/ux/format.js';

describe('formatSearchResult', () => {
  it('prints command and example with skill name', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [{
        command: 'git branch',
        example: 'git branch --show-current',
        skill_level: 2,
        intent_description: 'what branch am I on',
        risk_class: 'none',
      }],
      advanced: {
        command: 'git symbolic-ref',
        example: 'git symbolic-ref --short HEAD',
        skill_level: 4,
        intent_description: 'symbolic ref short',
        risk_class: 'none',
      },
      lowConfidence: false,
    });
    expect(text).toMatch(/git branch/);
    expect(text).toMatch(/show-current/);
    expect(text).toMatch(/beginner/);
    expect(text).not.toMatch(/Also \(advanced\)/);
  });

  it('shows advanced only when verbose', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [{
        command: 'git branch',
        example: 'git branch --show-current',
        skill_level: 1,
        intent_description: 'branch',
        risk_class: 'none',
        explanation: 'e',
        risks: 'r',
      }],
      advanced: {
        command: 'git symbolic-ref',
        example: 'git symbolic-ref --short HEAD',
        skill_level: 4,
        intent_description: 'plumbing',
        risk_class: 'none',
      },
    }, { verbose: true });
    expect(text).toMatch(/Also \(advanced\)/);
    expect(text).toMatch(/symbolic-ref/);
  });

  it('warns risk for non-technical and beginner', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [{
        command: 'git reset',
        example: 'git reset --hard HEAD~1',
        skill_level: 2,
        intent_description: 'hard reset',
        risk_class: 'destructive',
      }],
    });
    expect(text).toMatch(/\[RISK\]/);
  });

  it('primaryCommand returns example', () => {
    expect(primaryCommand({
      results: [{ command: 'git branch', example: 'git branch --show-current' }],
    })).toBe('git branch --show-current');
  });
});
