import { describe, expect, it, vi } from 'vitest';
import { searchHybrid, DEFAULT_ALPHA, DEFAULT_BETA } from '../../../common/src/search/hybrid.ts';

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
  it('returns results with title+description and fixed blend', async () => {
    const embed = vi.fn(async () => new Float32Array(384));
    const knn = vi.fn(async () => [
      {
        command_id: 'r1',
        title: 'Soft reset',
        description: 'undo commit keep staged',
        _forcedScore: 0.95,
        commands: [{ command: 'git reset --soft HEAD~1' }],
        risk: 0.3,
        example: 'git reset --soft HEAD~1',
        snippet: 'git reset --soft HEAD~1',
      },
      {
        command_id: 'r2',
        title: 'Status',
        description: 'show status',
        _forcedScore: 0.2,
        commands: [{ command: 'git status' }],
        risk: 0,
        example: 'git status',
        snippet: 'git status',
      },
    ]);
    const fts = vi.fn(async () => [
      { command_id: 'r1', bm25: -8 },
      { command_id: 'r2', bm25: -1 },
    ]);
    const hydrate = vi.fn(async (ids: (string | number)[]) =>
      ids.map((id) => ({
        command_id: id,
        commands: [{ command: id === 'r1' ? 'git reset --soft HEAD~1' : 'git status' }],
        example: id === 'r1' ? 'git reset --soft HEAD~1' : 'git status',
        snippet: '',
        title: id === 'r1' ? 'Soft reset' : 'Status',
        description: id === 'r1' ? 'undo commit keep staged' : 'show status',
        risk: 0,
      })),
    );

    const order: string[] = [];
    const result = await searchHybrid({
      query: '  undo last commit  ',
      thresholds: thr,
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
    expect(result.blend).toEqual({ alpha: DEFAULT_ALPHA, beta: DEFAULT_BETA });
    expect(result.preferredSkill).toBe('');
    expect(result.status === 'ok' || result.status === 'empty').toBe(true);
    expect(result.results.length).toBeGreaterThanOrEqual(result.displayResults.length);
    expect(result.displayResults[0]?.title).toBeTruthy();
    expect(result.displayResults[0]?.description).toBeTruthy();
    expect(order.includes('fts')).toBe(true);
    expect(order.includes('embed')).toBe(true);
  });

  it('returns empty when no hits', async () => {
    const result = await searchHybrid({
      query: 'nothing',
      thresholds: thr,
      embed: async () => new Float32Array(384),
      knn: async () => [],
      fts: async () => [],
      hydrate: async () => [],
    });
    expect(result.status).toBe('empty');
    expect(result.displayResults).toEqual([]);
    expect(result.alert).toBe('red');
  });
});
