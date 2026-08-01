import { describe, it, expect } from 'bun:test';
import {
  evaluateBank,
  formatEvalReport,
} from '../../packages/core/src/build/evalGate.js';
import {
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT_DISPLAY_RATE,
} from '../../packages/core/src/db/constants.js';

describe('eval gate metrics (integration-style)', () => {
  it('fails dual gate when hit@display is below 0.7 and never calls judge', async () => {
    const bank = [
      {
        query_text: 'show status',
        command_id: 1,
        mutation_kind: 'ground',
        primary_verb: 'git status',
      },
      {
        query_text: 'pretty log',
        command_id: 2,
        mutation_kind: 'flag',
        primary_verb: 'git log',
      },
      {
        query_text: 'rebase onto main',
        command_id: 3,
        mutation_kind: 'state',
        primary_verb: 'git rebase',
      },
    ];

    let llmCalls = 0;
    // Hit@display: 2/3 ≈ 0.67 < 0.7 → okHit false; Phase 2 skipped
    const searchFn = async (q) => {
      if (q.includes('status')) return [{ command_id: 1, snippet: 'git status' }];
      if (q.includes('log')) return [{ command_id: 2, snippet: 'git log --oneline' }];
      return [{ command_id: 99, snippet: 'git rebase -i' }];
    };

    const out = await evaluateBank(bank, searchFn, {
      minPassRate: EVAL_MIN_PASS_RATE,
      minHitAtDisplayRate: EVAL_MIN_HIT_AT_DISPLAY_RATE,
      verbLookup: {
        1: 'git status',
        2: 'git log',
        99: 'git rebase',
      },
      llmJsonObject: async () => {
        llmCalls += 1;
        return { utility: 0.95, reason: 'top hit is rebase' };
      },
    });

    expect(llmCalls).toBe(0);
    expect(out.skippedJudge).toBe(true);
    expect(out.hitPassed).toBe(2);
    expect(out.passed).toBe(2);
    expect(out.hitRate).toBeCloseTo(2 / 3, 5);
    expect(out.okHit).toBe(false);
    expect(out.ok).toBe(false);
    expect(formatEvalReport(out)).toContain('skipJudge');
    expect(formatEvalReport(out)).toContain('okHit=false');
  });

  it('hard-fails when Pass A rate < 0.9 even if verbRate is high', async () => {
    const bank = [
      { query_text: 'a', command_id: 1, mutation_kind: 'ground', primary_verb: 'git status' },
      { query_text: 'b', command_id: 2, mutation_kind: 'flag', primary_verb: 'git log' },
    ];
    let llmCalls = 0;
    const out = await evaluateBank(
      bank,
      async () => [{ command_id: 99, snippet: 'git status\ngit log' }],
      {
        minPassRate: EVAL_MIN_PASS_RATE,
        minHitAtDisplayRate: EVAL_MIN_HIT_AT_DISPLAY_RATE,
        verbLookup: { 99: 'git status' },
        llmJsonObject: async () => {
          llmCalls += 1;
          return { utility: 0.05, reason: 'no' };
        },
      },
    );
    // Hit@display = 0 → Phase1 KO → no judge
    expect(llmCalls).toBe(0);
    expect(out.passed).toBe(0);
    expect(out.hitRate).toBe(0);
    expect(out.okHit).toBe(false);
    expect(out.okPass).toBe(false);
    expect(out.ok).toBe(false);
    expect(out.skippedJudge).toBe(true);
  });

  it('passes dual gate when hit@display>=0.7 and passA>=0.9', async () => {
    const bank = Array.from({ length: 10 }, (_, i) => ({
      query_text: `q${i}`,
      command_id: i + 1,
      mutation_kind: 'ground',
      primary_verb: 'git status',
    }));
    let llmCalls = 0;
    // 8/10 hit@display; 2 rescued by judge → hit=0.8 passA=1.0
    const out = await evaluateBank(
      bank,
      async (q) => {
        const n = Number(String(q).replace(/\D/g, ''));
        if (n < 8) return [{ command_id: n + 1 }];
        return [{ command_id: 999 }];
      },
      {
        minPassRate: EVAL_MIN_PASS_RATE,
        minHitAtDisplayRate: EVAL_MIN_HIT_AT_DISPLAY_RATE,
        llmJsonObject: async () => {
          llmCalls += 1;
          return { utility: 0.96, reason: 'helpful toward intent' };
        },
      },
    );
    expect(llmCalls).toBe(2);
    expect(out.hitRate).toBe(0.8);
    expect(out.rate).toBe(1);
    expect(out.ok).toBe(true);
    expect(out.skippedJudge).toBe(false);
  });
});
