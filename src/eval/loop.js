import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const EVAL_LOOP_DEFAULTS = Object.freeze({
  requiredCycles: 5,
  newCasesPerCycle: 30,
  minPassRate: 0.9,
});

/**
 * Generate ≥N new eval cases from catalog intents (deterministic, offline).
 */
export function generateNewCasesFromIntents(intents, {
  count = 30,
  cycle = 1,
  seed = 'git-help',
} = {}) {
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new Error('No intents available to generate eval cases');
  }
  const cases = [];
  const used = new Set();
  let i = 0;
  let guard = 0;
  while (cases.length < count && guard < count * intents.length * 2) {
    guard += 1;
    const row = intents[(i + cycle * 17) % intents.length];
    i += 1;
    const query = String(row.intent_description || '').trim();
    if (!query || used.has(query)) continue;
    used.add(query);
    const idHash = createHash('sha256').update(`${seed}:${cycle}:${query}`).digest('hex').slice(0, 8);
    cases.push({
      id: `gen-c${cycle}-${idHash}`,
      query,
      expectedCommand: row.command,
      acceptableCommands: [row.command],
      expectedSkillBand: [row.skill_level, row.skill_level],
      judgeNotes: `Generated cycle ${cycle} from catalog intent`,
      tags: ['generated', `cycle-${cycle}`, row.topic || 'git'],
      source: 'catalog-intent',
      cycle,
    });
  }
  if (cases.length < count) {
    throw new Error(`Could only generate ${cases.length}/${count} unique cases`);
  }
  return cases;
}

export function loadGoldenCases(goldenPath) {
  return JSON.parse(readFileSync(goldenPath, 'utf8'));
}

export function loadIntentsJsonl(intentsPath) {
  if (!existsSync(intentsPath)) return [];
  return readFileSync(intentsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Eval loop state machine.
 * Cycles 1..N: each must pass golden + ≥newCasesPerCycle generated cases.
 * Final gate: golden + ALL accumulated generated cases.
 * On final failure → reset to cycle 0 and start over.
 */
export function createEvalLoopState(defaults = EVAL_LOOP_DEFAULTS) {
  return {
    schemaVersion: 1,
    requiredCycles: defaults.requiredCycles,
    newCasesPerCycle: defaults.newCasesPerCycle,
    minPassRate: defaults.minPassRate,
    completedCycles: 0,
    attempt: 1,
    phase: 'cycle', // cycle | final | done | failed
    accumulatedGenerated: [],
    history: [],
  };
}

export function nextCyclePlan(state, { golden, intents }) {
  if (state.phase === 'done') {
    return { type: 'done', cases: [] };
  }
  if (state.completedCycles >= state.requiredCycles) {
    return {
      type: 'final',
      cases: [...golden, ...state.accumulatedGenerated],
      label: `final-gate-attempt-${state.attempt}`,
    };
  }
  const cycle = state.completedCycles + 1;
  const generated = generateNewCasesFromIntents(intents, {
    count: state.newCasesPerCycle,
    cycle,
    seed: `attempt-${state.attempt}`,
  });
  return {
    type: 'cycle',
    cycle,
    generated,
    cases: [...golden, ...generated],
    label: `cycle-${cycle}-attempt-${state.attempt}`,
  };
}

/**
 * Apply a cycle/final result to state.
 * @returns {{ state, restart: boolean, done: boolean }}
 */
export function applyEvalResult(state, plan, report) {
  const pass = report.passRate >= state.minPassRate;
  const entry = {
    label: plan.label,
    type: plan.type,
    pass,
    passRate: report.passRate,
    avgScore: report.avgScore,
    caseCount: plan.cases.length,
  };
  const next = {
    ...state,
    history: [...state.history, entry],
  };

  if (plan.type === 'cycle') {
    if (!pass) {
      // failed cycle — restart entire 5+final
      return {
        state: {
          ...createEvalLoopState({
            requiredCycles: state.requiredCycles,
            newCasesPerCycle: state.newCasesPerCycle,
            minPassRate: state.minPassRate,
          }),
          attempt: state.attempt + 1,
          history: next.history,
        },
        restart: true,
        done: false,
      };
    }
    next.completedCycles = state.completedCycles + 1;
    next.accumulatedGenerated = [
      ...state.accumulatedGenerated,
      ...(plan.generated || []),
    ];
    if (next.completedCycles >= next.requiredCycles) {
      next.phase = 'final';
    }
    return { state: next, restart: false, done: false };
  }

  if (plan.type === 'final') {
    if (!pass) {
      return {
        state: {
          ...createEvalLoopState({
            requiredCycles: state.requiredCycles,
            newCasesPerCycle: state.newCasesPerCycle,
            minPassRate: state.minPassRate,
          }),
          attempt: state.attempt + 1,
          history: next.history,
        },
        restart: true,
        done: false,
      };
    }
    next.phase = 'done';
    return { state: next, restart: false, done: true };
  }

  return { state: next, restart: false, done: false };
}

export function saveEvalLoopState(file, state) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export function loadEvalLoopState(file, defaults = EVAL_LOOP_DEFAULTS) {
  if (!existsSync(file)) return createEvalLoopState(defaults);
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Run search+judge over a case list (injected deps for tests).
 */
export async function runCaseSuite(cases, { searchFn, judgeFn }) {
  const results = [];
  let passed = 0;
  let scoreSum = 0;
  for (const c of cases) {
    let actual = { command: null, skill_level: null, intent_description: null };
    try {
      const r = await searchFn(c.query);
      const top = r?.results?.[0];
      if (top) {
        actual = {
          command: top.command,
          skill_level: top.skill_level,
          intent_description: top.intent_description,
        };
      }
    } catch (e) {
      actual.error = e.message;
    }
    let verdict;
    try {
      verdict = await judgeFn(c, actual);
    } catch (e) {
      verdict = { score: 1, pass: false, rationale: `judge_error: ${e.message}` };
    }
    if (verdict.pass) passed += 1;
    scoreSum += Number(verdict.score) || 0;
    results.push({
      id: c.id,
      pass: Boolean(verdict.pass),
      score: verdict.score,
      expectedCommand: c.expectedCommand,
      actualCommand: actual.command,
      rationale: verdict.rationale,
    });
  }
  const total = cases.length || 1;
  return {
    passRate: passed / total,
    avgScore: scoreSum / total,
    passed,
    total: cases.length,
    cases: results,
  };
}
