// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import {
  formatSearchResult,
  primaryCommand,
  formatUsageFrame,
  parseUsage,
  formatSnippetBlock,
  SEARCH_FALLBACK_MESSAGE,
} from '../../common/src/ux/format.js';

describe('formatSearchResult hybrid', () => {
  const baseRow = {
    command_id: 1,
    command: 'git commit',
    example: 'git commit --amend --no-edit',
    usage: 'git commit --amend\nRewrites the previous commit.',
    skill_level: 'beginner',
    intent_text: 'add files to the last commit',
    score: 0.82,
    risk: 0.1,
    commands: [{ command: 'git commit --amend --no-edit', comment: 'amend' }],
  };

  it('exact band: single result, no alert copy', () => {
    const text = formatSearchResult({
      status: 'ok',
      confidence: 0.95,
      alert: 'none',
      displayResults: [baseRow],
      results: [baseRow],
    });
    expect(text).toMatch(/git commit/);
    expect(text).not.toMatch(/Several plausible/);
    expect(text).not.toMatch(/Uncertain match/);
  });

  it('yellow alert with 2 results', () => {
    const text = formatSearchResult({
      status: 'ok',
      confidence: 0.8,
      alert: 'yellow',
      displayResults: [
        baseRow,
        { ...baseRow, command_id: 2, example: 'git status', intent_text: 'status' },
      ],
      results: [],
    });
    expect(text).toMatch(/^1\. /m);
    expect(text).toMatch(/^2\. /m);
    expect(text).toMatch(/Several plausible/);
  });

  it('orange alert with 3 results', () => {
    const text = formatSearchResult({
      status: 'ok',
      confidence: 0.5,
      alert: 'orange',
      displayResults: [
        baseRow,
        { ...baseRow, command_id: 2, example: 'git a' },
        { ...baseRow, command_id: 3, example: 'git b' },
      ],
      results: [],
    });
    expect(text).toMatch(/Uncertain match/);
  });

  it('red: fallback only', () => {
    const text = formatSearchResult({
      status: 'empty',
      confidence: 0.2,
      alert: 'red',
      displayResults: [],
      results: [baseRow],
    });
    expect(text).toContain(SEARCH_FALLBACK_MESSAGE);
    expect(text).not.toMatch(/✅|⚠️|❌|ℹ️/);
  });

  it('high-risk uses caution copy without emoji by default', () => {
    const text = formatSearchResult({
      status: 'ok',
      confidence: 0.9,
      alert: 'none',
      displayResults: [{ ...baseRow, risk: 0.9 }],
      results: [],
    });
    expect(text).toMatch(/High-risk recipe/);
    expect(text).not.toMatch(/✅|⚠️|❌|ℹ️/);
  });

  it('high-risk banner includes risk exactly 0.7', () => {
    const text = formatSearchResult({
      status: 'ok',
      confidence: 0.9,
      alert: 'none',
      displayResults: [{ ...baseRow, risk: 0.7 }],
      results: [],
    });
    expect(text).toMatch(/High-risk recipe \(0\.70\)/);
  });
});

describe('primaryCommand', () => {
  it('uses displayResults first', () => {
    expect(
      primaryCommand({
        displayResults: [{ commands: [{ command: 'git status', run: 'git status' }] }],
        results: [],
      }),
    ).toMatch(/git status/);
  });
});

describe('parseUsage / snippet', () => {
  it('parses usage frame', () => {
    const { commandLine, blurb } = parseUsage({
      example: 'git status',
      usage: 'git status\nShow the working tree',
    });
    expect(commandLine).toBe('git status');
    expect(blurb).toMatch(/working tree/);
    expect(formatUsageFrame({ example: 'git status', usage: '' }).join('\n')).toMatch(/git status/);
  });

  it('formats commands with command field', () => {
    const lines = formatSnippetBlock({
      commands: [{ command: 'git reset --soft HEAD~1', comment: 'keep' }],
    });
    expect(lines.join('\n')).toMatch(/git reset/);
  });
});
