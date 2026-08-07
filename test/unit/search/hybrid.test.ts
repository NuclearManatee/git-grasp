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

  it('crowded near-tie distinct recipes → show 3 + orange (not red)', async () => {
    // Absolute scores nearly tied at the top so post-min-max gap stays < gapNarrow.
    const result = await searchHybrid({
      query: 'show branch history',
      thresholds: thr,
      preferredSkillOverride: 'beginner',
      verbs: [],
      embed: async () => new Float32Array(384),
      knn: async () => [
        {
          command_id: 10,
          skill_level_text: 'beginner',
          intent_text: 'log graph',
          _forcedScore: 0.85,
          commands: [{ command: 'git log --oneline --graph' }],
          risk: 0,
          example: 'git log --oneline --graph',
          snippet: 'git log --oneline --graph',
        },
        {
          command_id: 11,
          skill_level_text: 'beginner',
          intent_text: 'branch list',
          _forcedScore: 0.849,
          commands: [{ command: 'git branch -vv' }],
          risk: 0,
          example: 'git branch -vv',
          snippet: 'git branch -vv',
        },
        {
          command_id: 12,
          skill_level_text: 'beginner',
          intent_text: 'reflog',
          _forcedScore: 0.5,
          commands: [{ command: 'git reflog' }],
          risk: 0,
          example: 'git reflog',
          snippet: 'git reflog',
        },
      ],
      fts: async () => [],
      hydrate: async (ids) =>
        ids.map((id) => ({
          command_id: id,
          commands: [
            {
              command:
                id === 10
                  ? 'git log --oneline --graph'
                  : id === 11
                    ? 'git branch -vv'
                    : 'git reflog',
            },
          ],
          example:
            id === 10
              ? 'git log --oneline --graph'
              : id === 11
                ? 'git branch -vv'
                : 'git reflog',
          snippet: '',
          risk: 0,
        })),
    });
    expect(result.status).toBe('ok');
    expect(result.alert).toBe('orange');
    expect(result.displayResults.length).toBe(3);
    expect(result.gateEvidence).toBeDefined();
    expect(result.gateEvidence.topRawCosine).toBeGreaterThan(0.7);
  });

  it('junk query with weak absolute evidence → empty + red', async () => {
    const result = await searchHybrid({
      query: 'asdf qwerty zxcv unrelated nonsense',
      thresholds: thr,
      preferredSkillOverride: null,
      verbs: [],
      embed: async () => new Float32Array(384),
      knn: async () => [
        {
          command_id: 99,
          skill_level_text: 'beginner',
          intent_text: 'noise',
          _forcedScore: 0.35,
          commands: [{ command: 'git status' }],
          risk: 0,
          example: 'git status',
          snippet: 'git status',
        },
        {
          command_id: 98,
          skill_level_text: 'beginner',
          intent_text: 'noise2',
          _forcedScore: 0.3,
          commands: [{ command: 'git help' }],
          risk: 0,
          example: 'git help',
          snippet: 'git help',
        },
      ],
      fts: async () => [],
      hydrate: async (ids) =>
        ids.map((id) => ({
          command_id: id,
          commands: [{ command: id === 99 ? 'git status' : 'git help' }],
          example: id === 99 ? 'git status' : 'git help',
          snippet: '',
          risk: 0,
        })),
    });
    expect(result.status).toBe('empty');
    expect(result.alert).toBe('red');
    expect(result.displayResults).toEqual([]);
    expect(result.gateEvidence).toEqual({
      topRawCosine: 0.35,
      topHasBm25: false,
      topHasVerbBoost: false,
    });
  });

  it('exposes gateEvidence on ok results', async () => {
    const result = await searchHybrid({
      query: 'git status overview',
      thresholds: thr,
      preferredSkillOverride: 'beginner',
      verbs: ['status'],
      embed: async () => new Float32Array(384),
      knn: async () => [
        {
          command_id: 1,
          skill_level_text: 'beginner',
          intent_text: 'status',
          _forcedScore: 0.92,
          commands: [{ command: 'git status' }],
          risk: 0,
          example: 'git status',
          snippet: 'git status',
        },
      ],
      fts: async () => [{ command_id: 1, bm25: -10 }],
      hydrate: async () => [
        {
          command_id: 1,
          commands: [{ command: 'git status' }],
          example: 'git status',
          snippet: '',
          risk: 0,
        },
      ],
    });
    expect(result.gateEvidence).toMatchObject({
      topRawCosine: 0.92,
      topHasBm25: true,
      topHasVerbBoost: true,
    });
  });
});
