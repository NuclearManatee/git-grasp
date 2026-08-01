import { describe, it, expect } from 'vitest';
import {
  evaluateBank,
  formatEvalProgress,
  resolveEvalConcurrency,
} from '../../../common/src/build/evalGate.ts';
import { resolveEvalSearchPoolSize } from '../../../common/src/build/orchestrator.ts';
import { EVAL_CONCURRENCY, EVAL_SEARCH_POOL_SIZE } from '../../../common/src/db/constants.ts';

describe('resolveEvalConcurrency', () => {
  it('prefers opts.concurrency', () => {
    expect(resolveEvalConcurrency({ concurrency: 3 })).toBe(3);
  });

  it('falls back to default when unset', () => {
    const prev = process.env.GIT_GRASP_EVAL_CONCURRENCY;
    delete process.env.GIT_GRASP_EVAL_CONCURRENCY;
    expect(resolveEvalConcurrency({})).toBe(EVAL_CONCURRENCY);
    if (prev != null) process.env.GIT_GRASP_EVAL_CONCURRENCY = prev;
  });
});

describe('resolveEvalSearchPoolSize', () => {
  it('prefers opts.poolSize', () => {
    expect(resolveEvalSearchPoolSize({ poolSize: 4 })).toBe(4);
  });

  it('falls back to default when unset', () => {
    const prev = process.env.GIT_GRASP_EVAL_SEARCH_POOL;
    delete process.env.GIT_GRASP_EVAL_SEARCH_POOL;
    expect(resolveEvalSearchPoolSize({})).toBe(EVAL_SEARCH_POOL_SIZE);
    if (prev != null) process.env.GIT_GRASP_EVAL_SEARCH_POOL = prev;
  });
});

describe('evaluateBank parallel', () => {
  it('preserves order and pass rate under concurrency', async () => {
    const bank = Array.from({ length: 20 }, (_, i) => ({
      query_text: `q${i}`,
      command_id: i % 2 === 0 ? 1 : 99,
      kind: 'golden',
      mutation_kind: i % 2 === 0 ? 'flag' : 'state',
    }));

    const searchFn = async (q) => {
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
      const id = Number(String(q).replace(/\D/g, '')) % 2 === 0 ? 1 : 2;
      const hit = { command_id: id, example: 'git status', snippet: '' };
      return {
        results: [hit],
        displayResults: [hit],
        status: 'ok',
        alert: 'none',
        confidence: 0.95,
      };
    };

    const progress = [];
    const out = await evaluateBank(bank, searchFn, {
      concurrency: 8,
      progressEvery: 5,
      progressHeartbeatMs: 60_000,
      onProgress: (p) => progress.push({ ...p }),
      // Force Hit@display only path (no judge) by making misses fail without LLM:
      llmJsonObject: async () => ({ utility: 0.1, reason: 'no' }),
    });

    expect(out.total).toBe(20);
    expect(out.results).toHaveLength(20);
    expect(out.results[0].query.query_text).toBe('q0');
    expect(out.results[19].query.query_text).toBe('q19');
    // Even ids expect command_id 1 → hit; odd expect 99 → miss/ko
    expect(out.passed).toBe(10);
    expect(out.rate).toBeCloseTo(0.5, 5);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[0].done).toBe(0);
    expect(progress[progress.length - 1].done).toBe(20);
  });

  it('formatEvalProgress includes counters', () => {
    const s = formatEvalProgress({
      done: 10,
      total: 100,
      rate: 0.8,
      hitRate: 0.7,
      hit: 7,
      judge: 1,
      ko: 2,
      judgeError: 0,
      elapsedSec: 12,
      concurrency: 12,
    });
    expect(s).toMatch(/eval progress 10\/100/);
    expect(s).toMatch(/passA=0\.80/);
    expect(s).toMatch(/hit@display=0\.70/);
    expect(s).toMatch(/hit=7/);
    expect(s).toMatch(/concurrency=12/);
  });
});
