import { describe, it, expect } from 'vitest';
import {
  formatSearchResult,
  primaryCommand,
  formatUsageFrame,
  parseUsage,
  formatConfidenceLine,
  formatSnippetBlock,
} from '../../packages/core/src/ux/format.js';
import chalk from 'chalk';

describe('formatSearchResult', () => {
  const baseRow = {
    command: 'git commit',
    example: 'git commit --amend --no-edit',
    usage: 'git commit --amend\nRewrites the previous commit to include staged changes.',
    skill_level: 2,
    intent_description: 'add files to the last commit',
    explanation: 'Amends HEAD with staged changes.',
    score: 0.82,
  };

  it('prints framed usage and intent without skill on default', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [baseRow],
      confidence: 'ok',
      advanced: null,
    });
    expect(text).toMatch(/git commit/);
    expect(text).toMatch(/──/);
    expect(text).toMatch(/Rewrites the previous commit/);
    expect(text).toMatch(/add files to the last commit/);
    expect(text).not.toMatch(/beginner-level/);
    expect(text).not.toMatch(/\[RISK\]/);
    expect(text).not.toMatch(/solid match/);
  });

  it('adds skill suffix and score on verbose', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [baseRow],
      confidence: 'ok',
      advanced: {
        command: 'git commit',
        example: 'git commit --amend',
        usage: 'git commit --amend\nOpens editor.',
        skill_level: 4,
        intent_description: 'amend with editor',
      },
    }, { verbose: true });
    expect(text).toMatch(/beginner-level/);
    expect(text).toMatch(/Explanation/);
    expect(text).toMatch(/Also \(advanced\)/);
    expect(text).toMatch(/score:/);
    expect(text).not.toMatch(/Risks/);
  });

  it('shows yellow low confidence', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [{ ...baseRow, score: 0.40 }],
      confidence: 'low',
      lowConfidence: true,
    });
    expect(text).toMatch(/low confidence — rephrase/);
  });

  it('shows red very low confidence', () => {
    const text = formatSearchResult({
      status: 'ok',
      results: [{ ...baseRow, score: 0.20 }],
      confidence: 'very_low',
      lowConfidence: true,
    });
    expect(text).toMatch(/very low confidence/);
  });

  it('shows green on ambiguous when confident', () => {
    const text = formatSearchResult({
      status: 'ambiguous',
      ambiguous: true,
      confidence: 'ok',
      results: [baseRow, { ...baseRow, example: 'git commit -am "Fix typo"' }],
    });
    expect(text).toMatch(/looks like a solid match/);
    expect(text).toMatch(/rephrase with more detail/);
  });

  it('primaryCommand returns example', () => {
    expect(primaryCommand({ results: [baseRow] })).toBe('git commit --amend --no-edit');
  });
});

describe('parseUsage / formatUsageFrame', () => {
  it('splits command_line and blurb', () => {
    const p = parseUsage({
      example: 'git status',
      usage: 'git status -sb\nShort branch and dirty files.',
    });
    expect(p.commandLine).toBe('git status -sb');
    expect(p.blurb).toMatch(/Short branch/);
  });

  it('frames with dim rules', () => {
    const lines = formatUsageFrame({
      example: 'git status',
      usage: 'git status\nShow working tree status.',
    });
    expect(lines[0]).toMatch(/─/);
    expect(lines.join('\n')).toMatch(/Show working tree/);
  });
});

describe('formatConfidenceLine', () => {
  it('silent for ok single result without verbose', () => {
    expect(formatConfidenceLine({
      status: 'ok',
      confidence: 'ok',
      results: [{ score: 0.9 }],
    })).toBe('');
  });
});

describe('formatSnippetBlock colors', () => {
  it('uses cyan for run and dim for # comment', () => {
    const lines = formatSnippetBlock({
      commands: [{ run: 'git add .', comment: 'stage everything' }],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(chalk.cyan('git add .'));
    expect(lines[0]).toContain(chalk.dim('  # stage everything'));
  });
});
