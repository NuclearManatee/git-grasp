import { describe, it, expect } from 'vitest';
import {
  generateNewCasesFromIntents,
  createEvalLoopState,
  nextCyclePlan,
  applyEvalResult,
  runCaseSuite,
  summarizeCoveredAreas,
  buildEvalFocusPrompt,
  priorCasesForCycle,
  EVAL_LOOP_DEFAULTS,
} from '../../packages/core/src/eval/loop.js';

const intents = Array.from({ length: 200 }, (_, i) => ({
  command: `git cmd-${i}`,
  example: `git cmd-${i}`,
  skill_level: (i % 4) + 1,
  intent_description: `unique query number ${i} for testing eval generation`,
  topic: 'test',
  simplicity_rank: 1,
}));

const golden = [
  {
    id: 'g1',
    query: 'golden query one',
    expectedCommand: 'git status',
    acceptableCommands: ['git status'],
    expectedSkillBand: [1, 3],
  },
];

describe('generateNewCasesFromIntents', () => {
  it('happy: generates requested count', () => {
    const cases = generateNewCasesFromIntents(intents, { count: 30, cycle: 1 });
    expect(cases).toHaveLength(30);
    expect(new Set(cases.map((c) => c.query)).size).toBe(30);
  });

  it('negative: empty intents throws', () => {
    expect(() => generateNewCasesFromIntents([], { count: 30 })).toThrow(/No intents/);
  });

  it('edge: insufficient unique queries throws', () => {
    expect(() => generateNewCasesFromIntents(
      [{ command: 'git x', skill_level: 1, intent_description: 'same' }],
      { count: 5 },
    )).toThrow(/Could only generate/);
  });

  it('excludes prior queries and prefers focus commands', () => {
    const prior = intents.slice(0, 10).map((r) => r.intent_description);
    const cases = generateNewCasesFromIntents(intents, {
      count: 10,
      cycle: 2,
      excludeQueries: prior,
      preferCommands: ['git cmd-50'],
    });
    expect(cases.every((c) => !prior.includes(c.query))).toBe(true);
    expect(cases.some((c) => c.expectedCommand === 'git cmd-50')).toBe(true);
  });
});

describe('eval focus helpers', () => {
  it('summarizes covered areas and builds LLM prompt', () => {
    const covered = summarizeCoveredAreas([
      { query: 'stash work', expectedCommand: 'git stash', tags: ['stash', 'generated'] },
    ]);
    expect(covered.queries).toEqual(['stash work']);
    expect(covered.commands).toContain('git stash');
    const prompt = buildEvalFocusPrompt(covered, {
      topics: ['stash', 'rebase'],
      commands: ['git stash', 'git rebase'],
    }, { cycle: 2, count: 30 });
    expect(prompt.system).toMatch(/Concentrate on OTHER areas/i);
    expect(prompt.user).toMatch(/stash work/);
  });
});

describe('eval loop state machine', () => {
  it('positive: 5 cycles then final succeeds', () => {
    let state = createEvalLoopState({ ...EVAL_LOOP_DEFAULTS, minPassRate: 0.5 });
    for (let i = 0; i < 5; i += 1) {
      const plan = nextCyclePlan(state, { golden, intents });
      expect(plan.type).toBe('cycle');
      expect(plan.cases.length).toBeGreaterThanOrEqual(golden.length + 30);
      expect(priorCasesForCycle(state, golden).length).toBe(golden.length + state.accumulatedGenerated.length);
      const applied = applyEvalResult(state, plan, { passRate: 1, avgScore: 5 });
      expect(applied.restart).toBe(false);
      state = applied.state;
    }
    expect(state.phase).toBe('final');
    const finalPlan = nextCyclePlan(state, { golden, intents });
    expect(finalPlan.type).toBe('final');
    expect(finalPlan.cases.length).toBe(golden.length + 5 * 30);
    const done = applyEvalResult(state, finalPlan, { passRate: 0.95, avgScore: 4.5 });
    expect(done.done).toBe(true);
    expect(done.state.phase).toBe('done');
  });

  it('later cycles exclude prior generated queries', () => {
    let state = createEvalLoopState({ ...EVAL_LOOP_DEFAULTS, minPassRate: 0.5, requiredCycles: 2 });
    const c1 = nextCyclePlan(state, { golden, intents });
    state = applyEvalResult(state, c1, { passRate: 1, avgScore: 5 }).state;
    const c2 = nextCyclePlan(state, { golden, intents });
    const priorQs = new Set(c1.generated.map((c) => c.query));
    expect(c2.generated.every((c) => !priorQs.has(c.query))).toBe(true);
  });

  it('fault: failed cycle restarts attempt', () => {
    let state = createEvalLoopState({ minPassRate: 0.9, requiredCycles: 5, newCasesPerCycle: 30 });
    const plan = nextCyclePlan(state, { golden, intents });
    const applied = applyEvalResult(state, plan, { passRate: 0.1, avgScore: 1 });
    expect(applied.restart).toBe(true);
    expect(applied.state.completedCycles).toBe(0);
    expect(applied.state.attempt).toBe(2);
    expect(applied.state.accumulatedGenerated).toHaveLength(0);
  });

  it('fault: failed final restarts entire sequence', () => {
    let state = createEvalLoopState({ minPassRate: 0.9, requiredCycles: 2, newCasesPerCycle: 30 });
    for (let i = 0; i < 2; i += 1) {
      const plan = nextCyclePlan(state, { golden, intents });
      state = applyEvalResult(state, plan, { passRate: 1, avgScore: 5 }).state;
    }
    const finalPlan = nextCyclePlan(state, { golden, intents });
    const applied = applyEvalResult(state, finalPlan, { passRate: 0.5, avgScore: 2 });
    expect(applied.restart).toBe(true);
    expect(applied.state.completedCycles).toBe(0);
    expect(applied.state.phase).toBe('cycle');
  });
});

describe('runCaseSuite', () => {
  it('happy path scoring', async () => {
    const report = await runCaseSuite(golden, {
      searchFn: async () => ({ results: [{ command: 'git status', skill_level: 1, intent_description: 'x' }] }),
      judgeFn: async () => ({ pass: true, score: 5, rationale: 'ok' }),
    });
    expect(report.passRate).toBe(1);
    expect(report.passed).toBe(1);
  });

  it('negative: search/judge failures count as fail', async () => {
    const report = await runCaseSuite(golden, {
      searchFn: async () => { throw new Error('down'); },
      judgeFn: async () => { throw new Error('judge down'); },
    });
    expect(report.passRate).toBe(0);
    expect(report.cases[0].rationale).toMatch(/judge_error/);
  });
});
