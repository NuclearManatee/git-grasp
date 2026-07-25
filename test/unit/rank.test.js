import { describe, it, expect } from 'vitest';
import { rankResults, normalizeQuery } from '../../src/search/rank.js';
import { mockEmbed } from '../../src/search/embed.js';

const thresholds = {
  topK: 5,
  minScore: 0.2,
  maxSecondGap: 0.05,
  lowConfidenceScore: 0.9,
  requireSkillConsistency: true,
};

describe('rankResults', () => {
  it('returns best match', () => {
    const intent = 'undo last commit keep files';
    const rows = [
      { command: 'git reset --soft HEAD~1', skill_level: 3, intent_description: intent, embedding: mockEmbed(intent), risk_class: 'low' },
      { command: 'git status', skill_level: 1, intent_description: 'show status', embedding: mockEmbed('show status'), risk_class: 'none' },
    ];
    const r = rankResults(rows, mockEmbed(intent), thresholds);
    expect(r.results[0].command).toContain('reset');
  });

  it('filters skill level', () => {
    const rows = [
      { command: 'git a', skill_level: 1, intent_description: 'a', embedding: mockEmbed('a'), risk_class: 'none' },
      { command: 'git b', skill_level: 5, intent_description: 'a', embedding: mockEmbed('a'), risk_class: 'none' },
    ];
    const r = rankResults(rows, mockEmbed('a'), thresholds, { skillLevel: 5 });
    expect(r.results.every((x) => x.skill_level === 5)).toBe(true);
  });

  it('flags low confidence', () => {
    const rows = [
      { command: 'git x', skill_level: 1, intent_description: 'zzz', embedding: mockEmbed('zzz'), risk_class: 'none' },
    ];
    const r = rankResults(rows, mockEmbed('totally different'), { ...thresholds, lowConfidenceScore: 0.99, minScore: 0.99 });
    expect(r.lowConfidence).toBe(true);
  });
});

describe('normalizeQuery', () => {
  it('lowercases and strips punct', () => {
    expect(normalizeQuery('Undo, Commit!!!')).toBe('undo commit');
  });
});
