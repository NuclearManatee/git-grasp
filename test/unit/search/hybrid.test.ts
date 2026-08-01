import { describe, expect, it, vi } from 'vitest';
import { searchHybrid } from '../../../common/src/search/hybrid.ts';

const thr = {
  schemaVersion: 5,
  topK: 3,
  recallK: 100,
  confidenceVeryHigh: 0.9,
  confidenceHigh: 0.75,
  confidenceMedium: 0.4,
  normalizeQuery: true,
};

describe('searchHybrid', () => {
  it('returns Q36 shape with results >= displayResults', async () => {
    const embed = vi.fn(async () => new Float32Array(384));
    const knn = vi.fn(async () => [
      {
        command_id: 1,
        skill_level_text: 'beginner',
        intent_text: 'undo commit',
        intent_category: 'goal',
        _forcedScore: 0.95,
        commands: [{ command: 'git reset --soft HEAD~1' }],
        risk: 0.3,
        example: 'git reset --soft HEAD~1',
        snippet: 'git reset --soft HEAD~1',
      },
      {
        command_id: 2,
        skill_level_text: 'beginner',
        intent_text: 'status',
        intent_category: 'goal',
        _forcedScore: 0.2,
        commands: [{ command: 'git status' }],
        risk: 0,
        example: 'git status',
        snippet: 'git status',
      },
    ]);
    const fts = vi.fn(async () => [
      { command_id: 1, bm25: -8 },
      { command_id: 2, bm25: -1 },
    ]);
    const hydrate = vi.fn(async (ids: number[]) =>
      ids.map((id) => ({
        command_id: id,
        commands: [{ command: id === 1 ? 'git reset --soft HEAD~1' : 'git status' }],
        example: id === 1 ? 'git reset --soft HEAD~1' : 'git status',
        snippet: '',
        risk: 0,
      })),
    );

    const order: string[] = [];
    const result = await searchHybrid({
      query: '  undo last commit  ',
      thresholds: thr,
      preferredSkillOverride: 'beginner',
      verbs: ['reset', 'status'],
      embed: async () => {
        order.push('embed');
        return embed();
      },
      knn: async (vec, k) => {
        order.push('knn');
        return knn(vec, k);
      },
      fts: async (q, k) => {
        order.push('fts');
        await new Promise((r) => setTimeout(r, 5));
        return fts(q, k);
      },
      hydrate,
    });

    expect(result.query).toBe('undo last commit');
    expect(result.blend).toEqual({ alpha: 0.7, beta: 0.3 });
    expect(result.preferredSkill).toBe('beginner');
    expect(result.status === 'ok' || result.status === 'empty').toBe(true);
    expect(typeof result.confidence).toBe('number');
    expect(result.results.length).toBeGreaterThanOrEqual(result.displayResults.length);
    expect(result.results[0].command_id).toBe(1);
    expect(order.includes('fts')).toBe(true);
    expect(order.includes('embed')).toBe(true);
    // FTS starts before knn (knn waits on embed)
    expect(order.indexOf('fts')).toBeLessThan(order.indexOf('knn'));
  });

  it('empty both channels → empty status', async () => {
    const result = await searchHybrid({
      query: 'nothing',
      thresholds: thr,
      preferredSkillOverride: null,
      verbs: [],
      embed: async () => new Float32Array(384),
      knn: async () => [],
      fts: async () => [],
      hydrate: async () => [],
    });
    expect(result.status).toBe('empty');
    expect(result.displayResults).toEqual([]);
    expect(result.results).toEqual([]);
  });

  it('dedupes identical recipes before display (exact band may show only top)', async () => {
    const result = await searchHybrid({
      query: 'who wrote this',
      thresholds: thr,
      preferredSkillOverride: 'beginner',
      verbs: ['blame'],
      embed: async () => new Float32Array(384),
      knn: async () => [
        {
          command_id: 1,
          skill_level_text: 'beginner',
          intent_text: 'a',
          _forcedScore: 0.95,
          commands: [{ command: 'git blame file.txt' }],
          risk: 0.1,
          example: 'git blame file.txt',
          snippet: 'git blame file.txt',
        },
        {
          command_id: 2,
          skill_level_text: 'beginner',
          intent_text: 'b',
          _forcedScore: 0.9,
          commands: [{ command: 'git blame file.txt' }],
          risk: 0.1,
          example: 'git blame file.txt',
          snippet: 'git blame file.txt',
        },
        {
          command_id: 3,
          skill_level_text: 'beginner',
          intent_text: 'c',
          _forcedScore: 0.5,
          commands: [{ command: 'git log -p -- file.txt' }],
          risk: 0.1,
          example: 'git log -p -- file.txt',
          snippet: 'git log -p -- file.txt',
        },
      ],
      fts: async () => [],
      hydrate: async (ids) =>
        ids.map((id) => ({
          command_id: id,
          commands: [
            {
              command:
                id === 3 ? 'git log -p -- file.txt' : 'git blame file.txt',
            },
          ],
          example: id === 3 ? 'git log -p -- file.txt' : 'git blame file.txt',
          snippet: '',
          risk: 0.1,
        })),
    });
    expect(result.results.length).toBe(3);
    // Clone command_id 2 never appears beside 1 in display
    expect(result.displayResults.every((h) => h.command_id !== 2)).toBe(true);
    expect(result.displayResults[0]?.command_id).toBe(1);
    if (result.alert === 'orange' || result.alert === 'yellow') {
      expect(result.displayResults.map((h) => h.command_id)).toContain(3);
    }
  });
});
