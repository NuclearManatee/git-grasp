import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../../../common/src/lib/paths.ts';
import {
  DEFAULT_RECALL_K,
  SEARCH_ALGORITHM_VERSION,
  SCHEMA_VERSION,
} from '../../../common/src/db/constants.ts';
import { ThresholdsSchema } from '../../../common/src/schemas/thresholds.ts';
import { SKILL_LEVELS } from '../../../common/src/lib/skills.ts';

describe('search hybrid contracts', () => {
  it('exports SEARCH_ALGORITHM_VERSION and recallK=100', () => {
    expect(SEARCH_ALGORITHM_VERSION).toBe(3);
    expect(DEFAULT_RECALL_K).toBe(100);
    expect(SCHEMA_VERSION).toBe(9);
  });

  it('parses hybrid thresholds shape exactly', () => {
    const raw = {
      schemaVersion: 5,
      topK: 3,
      recallK: 100,
      confidenceVeryHigh: 0.9,
      confidenceHigh: 0.75,
      confidenceMedium: 0.4,
      normalizeQuery: true,
    };
    const t = ThresholdsSchema.parse(raw);
    expect(t.confidenceVeryHigh).toBe(0.9);
    expect(t.confidenceHigh).toBe(0.75);
    expect(t.confidenceMedium).toBe(0.4);
  });

  it('rejects legacy threshold keys as unknown (strict)', () => {
    expect(() =>
      ThresholdsSchema.parse({
        schemaVersion: 5,
        topK: 3,
        recallK: 100,
        confidenceVeryHigh: 0.9,
        confidenceHigh: 0.75,
        confidenceMedium: 0.4,
        normalizeQuery: true,
        minScore: 0.25,
      }),
    ).toThrow();
  });

  it('ships common/config/thresholds.json matching hybrid schema', () => {
    const p = path.join(PACKAGE_ROOT, 'common', 'config', 'thresholds.json');
    expect(existsSync(p)).toBe(true);
    const raw = JSON.parse(readFileSync(p, 'utf8'));
    expect(ThresholdsSchema.parse(raw)).toMatchObject({
      topK: 3,
      recallK: 100,
      confidenceVeryHigh: 0.9,
      confidenceHigh: 0.75,
      confidenceMedium: 0.4,
    });
  });

  it('ships Search-DataModel and Search-Algoritm specs', () => {
    const dir = path.join(PACKAGE_ROOT, 'local', 'spec', 'new');
    expect(existsSync(path.join(dir, 'Search-DataModel.md'))).toBe(true);
    expect(existsSync(path.join(dir, 'Search-Algoritm.md'))).toBe(true);
    const dm = readFileSync(path.join(dir, 'Search-DataModel.md'), 'utf8');
    const al = readFileSync(path.join(dir, 'Search-Algoritm.md'), 'utf8');
    expect(dm).toMatch(/commands_fts/);
    expect(dm).toMatch(/search_algorithm_version/);
    expect(dm).toMatch(/git_verbs/);
    expect(al).toMatch(/confidence/i);
    expect(al).toMatch(/alpha|α/i);
    expect(al).not.toMatch(/LLM-as-a-Judge for grey zones/);
  });

  it('keeps four skill levels', () => {
    expect([...SKILL_LEVELS]).toEqual([
      'nontechnical',
      'beginner',
      'intermediate',
      'expert',
    ]);
  });
});
