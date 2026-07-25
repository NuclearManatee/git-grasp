import { describe, it, expect } from 'vitest';
import {
  rankResults,
  normalizeQuery,
  preferSimplestInFamily,
  preferSpecificExamples,
  confidenceTier,
} from '../../src/search/rank.js';
import { mockEmbed } from '../../src/search/embed.js';

const thresholds = {
  topK: 5,
  minScore: 0.2,
  maxSecondGap: 0.05,
  lowConfidenceScore: 0.9,
  confidenceYellowScore: 0.45,
  confidenceRedScore: 0.30,
  requireSkillConsistency: true,
  simplicityWindow: 0.15,
  advancedWindow: 0.2,
};

describe('confidenceTier', () => {
  it('classifies ok/low/very_low', () => {
    expect(confidenceTier(0.5, 0.45, 0.30)).toBe('ok');
    expect(confidenceTier(0.40, 0.45, 0.30)).toBe('low');
    expect(confidenceTier(0.20, 0.45, 0.30)).toBe('very_low');
  });
});

describe('rankResults', () => {
  it('returns best match', () => {
    const intent = 'undo last commit keep files';
    const rows = [
      {
        command: 'git reset',
        example: 'git reset --soft HEAD~1',
        skill_level: 3,
        intent_description: intent,
        embedding: mockEmbed(intent),
        intent_family: 'soft-undo',
        simplicity_rank: 1,
      },
      {
        command: 'git status',
        example: 'git status',
        skill_level: 1,
        intent_description: 'show status',
        embedding: mockEmbed('show status'),
        intent_family: 'status',
        simplicity_rank: 1,
      },
    ];
    const r = rankResults(rows, mockEmbed(intent), thresholds);
    expect(r.results[0].example).toContain('reset');
  });

  it('filters skill level at most', () => {
    const rows = [
      {
        command: 'git a',
        example: 'git a',
        skill_level: 1,
        intent_description: 'a',
        embedding: mockEmbed('a'),
        intent_family: 'a',
        simplicity_rank: 1,
      },
      {
        command: 'git b',
        example: 'git b',
        skill_level: 4,
        intent_description: 'a',
        embedding: mockEmbed('a'),
        intent_family: 'b',
        simplicity_rank: 1,
      },
    ];
    const r = rankResults(rows, mockEmbed('a'), thresholds, { skillLevel: 2 });
    expect(r.results.every((x) => x.skill_level <= 2)).toBe(true);
    expect(r.results[0].command).toBe('git a');
  });

  it('flags low confidence', () => {
    const rows = [
      {
        command: 'git x',
        example: 'git x',
        skill_level: 1,
        intent_description: 'zzz',
        embedding: mockEmbed('zzz'),
        intent_family: 'x',
        simplicity_rank: 1,
      },
    ];
    const r = rankResults(rows, mockEmbed('totally different'), {
      ...thresholds,
      confidenceYellowScore: 0.99,
      confidenceRedScore: 0.5,
      minScore: 0.99,
    });
    expect(r.lowConfidence).toBe(true);
    expect(r.confidence).not.toBe('ok');
  });

  it('prefers specific example over bare prefix when close', () => {
    const intent = 'undo last commit keep files';
    const emb = mockEmbed(intent);
    const rows = [
      {
        command: 'git reset',
        example: 'git reset',
        skill_level: 1,
        intent_description: intent,
        embedding: emb,
        intent_family: 'undo-soft',
        simplicity_rank: 2,
      },
      {
        command: 'git reset',
        example: 'git reset --soft HEAD~1',
        skill_level: 2,
        intent_description: intent,
        embedding: emb,
        intent_family: 'undo-soft',
        simplicity_rank: 1,
      },
    ];
    const r = rankResults(rows, emb, {
      ...thresholds,
      specificityWindow: 0.5,
      specificityPromoteMargin: 0.05,
      maxSecondGap: 0.01,
    });
    expect(r.results[0].example).toBe('git reset --soft HEAD~1');
  });

  it('prefers simplest in family and attaches advanced', () => {
    const intent = 'current branch name';
    const emb = mockEmbed(intent);
    const rows = [
      {
        command: 'git symbolic-ref',
        example: 'git symbolic-ref --short HEAD',
        skill_level: 4,
        intent_description: intent,
        embedding: emb,
        intent_family: 'show-current-branch',
        simplicity_rank: 3,
      },
      {
        command: 'git branch',
        example: 'git branch --show-current',
        skill_level: 1,
        intent_description: intent,
        embedding: emb,
        intent_family: 'show-current-branch',
        simplicity_rank: 1,
      },
    ];
    const r = rankResults(rows, emb, thresholds);
    expect(r.results[0].example).toBe('git branch --show-current');
    expect(r.advanced?.example).toBe('git symbolic-ref --short HEAD');
  });
});

describe('preferSimplestInFamily', () => {
  it('promotes lower rank within window', () => {
    const scored = [
      { example: 'a', score: 0.9, intent_family: 'f', simplicity_rank: 3 },
      { example: 'b', score: 0.88, intent_family: 'f', simplicity_rank: 1 },
    ];
    preferSimplestInFamily(scored, 0.05);
    expect(scored[0].example).toBe('b');
  });
});

describe('preferSpecificExamples', () => {
  it('promotes longer prefix form', () => {
    const scored = [
      { example: 'git reset', score: 0.9, command: 'git reset' },
      { example: 'git reset --soft HEAD~1', score: 0.89, command: 'git reset' },
    ];
    preferSpecificExamples(scored, 0.2, 0.05);
    expect(scored[0].example).toBe('git reset --soft HEAD~1');
  });
});

describe('normalizeQuery', () => {
  it('lowercases and strips punct', () => {
    expect(normalizeQuery('Undo, Commit!!!')).toBe('undo commit');
  });
});
