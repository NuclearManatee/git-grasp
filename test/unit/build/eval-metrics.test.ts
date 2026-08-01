import { describe, it, expect } from 'vitest';
import {
  hitAtDisplay,
  hitAtDisplayVerb,
  evaluateQuery,
  evaluateBank,
  stratifyResultsByMutationKind,
  formatEvalReport,
  JUDGE_SYSTEM_PROMPT,
} from '../../../common/src/build/evalGate.ts';
import {
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT_DISPLAY_RATE,
} from '../../../common/src/db/constants.ts';

describe('eval metrics', () => {
  it('hitAtDisplay matches command_id', () => {
    expect(hitAtDisplay([{ command_id: 1 }, { command_id: 7 }], 7)).toBe(true);
    expect(hitAtDisplay([{ command_id: 1 }], 7)).toBe(false);
  });

  it('hitAtDisplayVerb matches primary verb via lookup', () => {
    const hits = [{ command_id: 2 }, { command_id: 3 }];
    const lookup = { 2: 'git status', 3: 'git log' };
    expect(hitAtDisplayVerb(hits, 'git status', lookup)).toBe(true);
    expect(hitAtDisplayVerb(hits, 'git rebase', lookup)).toBe(false);
  });

  it('hitAtDisplayVerb can read verb from snippet', () => {
    const hits = [{ command_id: 9, snippet: 'git stash\ngit rebase' }];
    expect(hitAtDisplayVerb(hits, 'git rebase', {})).toBe(true);
  });

  it('evaluateQuery returns passVerb alongside pass', async () => {
    const r = await evaluateQuery(
      { query_text: 'status', command_id: 7, primary_verb: 'git status', mutation_kind: 'ground' },
      async () => [{ command_id: 1, snippet: 'git status' }],
      {
        verbLookup: { 1: 'git status' },
        llmJsonObject: async () => ({ utility: 0.2, reason: 'no' }),
      },
    );
    expect(r.pass).toBe(false);
    expect(r.passVerb).toBe(true);
  });

  it('evaluateBank Phase1 KO skips LLM judge entirely', async () => {
    const bank = [
      { query_text: 'a', command_id: 1, mutation_kind: 'ground', primary_verb: 'git status' },
      { query_text: 'b', command_id: 2, mutation_kind: 'flag', primary_verb: 'git log' },
    ];
    let llmCalls = 0;
    let skipInfo = null;
    const out = await evaluateBank(
      bank,
      async (q) => {
        if (q === 'a') return [{ command_id: 1 }];
        return [{ command_id: 99, snippet: 'git log' }];
      },
      {
        minPassRate: EVAL_MIN_PASS_RATE,
        minHitAtDisplayRate: EVAL_MIN_HIT_AT_DISPLAY_RATE,
        verbLookup: { 1: 'git status', 99: 'git log' },
        llmJsonObject: async () => {
          llmCalls += 1;
          return { utility: 0.1, reason: 'wrong recipe' };
        },
        onSkipJudge: (info) => {
          skipInfo = info;
        },
      },
    );
    expect(llmCalls).toBe(0);
    expect(out.skippedJudge).toBe(true);
    expect(out.hitPassed).toBe(1);
    expect(out.hitRate).toBe(0.5);
    expect(out.okHit).toBe(false);
    expect(out.okPass).toBe(false);
    expect(out.ok).toBe(false);
    expect(out.judgePassed).toBe(0);
    expect(out.judgeSummary.judgeCalls).toBe(0);
    expect(skipInfo).toBeTruthy();
    expect(formatEvalReport(out)).toMatch(/skipJudge/);
    expect(formatEvalReport(out)).toMatch(/timing eval/);
  });

  it('evaluateBank ok when hit@display and passA both clear gates', async () => {
    const bank = [
      { query_text: 'a', command_id: 1, mutation_kind: 'ground', primary_verb: 'git status' },
      { query_text: 'b', command_id: 2, mutation_kind: 'flag', primary_verb: 'git log' },
      { query_text: 'c', command_id: 3, mutation_kind: 'state', primary_verb: 'git rebase' },
      { query_text: 'd', command_id: 4, mutation_kind: 'flag', primary_verb: 'git stash' },
    ];
    let llmCalls = 0;
    // 3/4 hit@display (=0.75>=0.7); 4th rescued by judge → passA=1.0>=0.9
    const out = await evaluateBank(
      bank,
      async (q) => {
        if (q === 'a') return [{ command_id: 1 }];
        if (q === 'b') return [{ command_id: 2 }];
        if (q === 'c') return [{ command_id: 3 }];
        return [{ command_id: 99, snippet: 'git status' }];
      },
      {
        minPassRate: EVAL_MIN_PASS_RATE,
        minHitAtDisplayRate: EVAL_MIN_HIT_AT_DISPLAY_RATE,
        llmJsonObject: async () => {
          llmCalls += 1;
          return { utility: 0.95, reason: 'helpful for stash query' };
        },
      },
    );
    expect(llmCalls).toBe(1);
    expect(out.hitRate).toBe(0.75);
    expect(out.rate).toBe(1);
    expect(out.okHit).toBe(true);
    expect(out.okPass).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.judgePassed).toBe(1);
    expect(out.skippedJudge).toBe(false);
  });

  it('evaluateBank Phase2 only runs after hit@display clears', async () => {
    const bank = Array.from({ length: 10 }, (_, i) => ({
      query_text: `q${i}`,
      command_id: i + 1,
      mutation_kind: 'ground',
      primary_verb: 'git status',
    }));
    let llmCalls = 0;
    // 8/10 hit → phase2 judges 2 misses
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
    expect(out.ok).toBe(true);
  });

  it('exports judge criteria prompt', () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/utility/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/reason/i);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/abstain/i);
  });

  it('stratifyResultsByMutationKind groups rows', () => {
    const results = [
      { pass: true, query: { mutation_kind: 'ground' } },
      { pass: false, query: { mutation_kind: 'state' } },
      { pass: true, query: { mutation_kind: 'state' } },
    ];
    const s = stratifyResultsByMutationKind(results);
    expect(s.ground).toEqual({ passed: 1, total: 1, rate: 1 });
    expect(s.state.passed).toBe(1);
    expect(s.state.total).toBe(2);
  });
});
