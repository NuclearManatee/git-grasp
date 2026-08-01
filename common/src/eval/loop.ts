// @ts-nocheck
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeExample } from '../lib/validator.js';
import { isCommandLikeIntent } from '../catalog/intentHygiene.js';
import { renderPrompt } from '../lib/prompts.js';

export const EVAL_LOOP_DEFAULTS = Object.freeze({
  requiredCycles: 5,
  newCasesPerCycle: 30,
  minPassRate: 0.9,
});

/**
 * Map schema-v5 intents (+ recipes) into the shape generateNewCasesFromIntents expects.
 * @param {object[]} intents
 * @param {object[]} recipes
 */
export function intentsForEvalGeneration(intents, recipes = []) {
  const byId = new Map((recipes || []).map((r) => [r.id, r]));
  const out = [];
  for (const row of intents || []) {
    const text = String(row.intent_text || row.intent_description || '').trim();
    if (!text || isCommandLikeIntent(text)) continue;
    const recipe = row.recipe_id ? byId.get(row.recipe_id) : null;
    const primary = normalizeExample(recipe?.primary_example || recipe?.commands?.[0]?.run || '');
    if (primary && normalizeExample(text).toLowerCase() === primary.toLowerCase()) continue;
    const example = normalizeExample(
      row.example
        || recipe?.primary_example
        || recipe?.commands?.[0]?.run
        || row.command
        || '',
    );
    const command = normalizeExample(
      row.command
        || recipe?.command
        || (example ? example.split(/\s+/).slice(0, 2).join(' ') : ''),
    );
    if (!command && !recipe?.id) continue;
    out.push({
      command: command || recipe?.command || 'git',
      example: example || command,
      intent_description: text,
      skill_level: Number(row.skill_level) || 2,
      recipe_id: row.recipe_id || recipe?.id || '',
      simplicity_rank: Number(row.simplicity_rank ?? recipe?.simplicity_rank ?? 1),
      topic: row.topic || recipe?.topic || 'git',
    });
  }
  return out;
}

/**
 * Prior cases used for diversification (golden + accumulated generated).
 * @param {object} state
 * @param {object[]} golden
 */
export function priorCasesForCycle(state, golden = []) {
  return [...(golden || []), ...(state?.accumulatedGenerated || [])];
}

/**
 * Summarize covered queries / topics / commands for LLM focus prompts.
 * @param {object[]} cases
 */
export function summarizeCoveredAreas(cases = []) {
  const queries = [];
  const topics = new Set();
  const commands = new Set();
  for (const c of cases || []) {
    const q = String(c.query || '').trim();
    if (q) queries.push(q);
    for (const t of c.tags || []) {
      if (t && t !== 'generated' && !String(t).startsWith('cycle-')) topics.add(String(t));
    }
    if (c.expectedCommand) commands.add(normalizeExample(c.expectedCommand));
    for (const cmd of c.acceptableCommands || []) {
      if (cmd) commands.add(normalizeExample(cmd));
    }
  }
  return {
    queries,
    topics: [...topics].sort(),
    commands: [...commands].sort(),
  };
}

/**
 * Build the LLM prompt that steers later cycles toward uncovered areas.
 * @param {{ queries: string[], topics: string[], commands: string[] }} covered
 * @param {{ topics: string[], commands: string[] }} catalog
 * @param {{ cycle?: number, count?: number }} [opts]
 */
export function buildEvalFocusPrompt(covered, catalog, { cycle = 1, count = 30 } = {}) {
  const priorQueries = (covered.queries || []).slice(0, 120);
  const priorMore = Math.max(0, (covered.queries || []).length - priorQueries.length);
  const { messages } = renderPrompt('eval/focus-cycle', {
    user_json: JSON.stringify({
      cycle,
      newCasesNeeded: count,
      priorCaseCount: (covered.queries || []).length,
      priorQueries,
      priorQueriesOmitted: priorMore,
      coveredTopics: covered.topics || [],
      coveredCommands: covered.commands || [],
      catalogTopics: (catalog.topics || []).slice(0, 80),
      catalogCommands: (catalog.commands || []).slice(0, 120),
      instruction: 'Concentrate on areas not well represented in prior cases.',
    }),
  });
  return {
    system: messages.find((m) => m.role === 'system')?.content || '',
    user: messages.find((m) => m.role === 'user')?.content || '',
  };
}

function intentMatchesFocus(row, preferTopics, preferCommands) {
  const topicOk = preferTopics.size === 0 || preferTopics.has(String(row.topic || '').toLowerCase());
  const cmd = normalizeExample(row.command || '').toLowerCase();
  const cmdOk = preferCommands.size === 0 || preferCommands.has(cmd);
  if (preferTopics.size && preferCommands.size) return topicOk || cmdOk;
  if (preferTopics.size) return topicOk;
  if (preferCommands.size) return cmdOk;
  return true;
}

/**
 * Generate ÔëÑN new eval cases from catalog intents (deterministic, offline).
 * @param {object[]} intents
 * @param {{
 *   count?: number,
 *   cycle?: number,
 *   seed?: string,
 *   excludeQueries?: Iterable<string>,
 *   preferTopics?: string[],
 *   preferCommands?: string[],
 * }} [opts]
 */
export function generateNewCasesFromIntents(intents, {
  count = 30,
  cycle = 1,
  seed = 'git-grasp',
  excludeQueries = [],
  preferTopics = [],
  preferCommands = [],
} = {}) {
  if (!Array.isArray(intents) || intents.length === 0) {
    throw new Error('No intents available to generate eval cases');
  }
  const used = new Set(
    [...excludeQueries].map((q) => String(q || '').trim().toLowerCase()).filter(Boolean),
  );
  const topicSet = new Set(
    (preferTopics || []).map((t) => String(t || '').trim().toLowerCase()).filter(Boolean),
  );
  const commandSet = new Set(
    (preferCommands || []).map((c) => normalizeExample(c).toLowerCase()).filter(Boolean),
  );

  const preferred = [];
  const rest = [];
  for (const row of intents) {
    if (intentMatchesFocus(row, topicSet, commandSet) && (topicSet.size || commandSet.size)) {
      preferred.push(row);
    } else {
      rest.push(row);
    }
  }
  const pools = preferred.length ? [preferred, rest] : [intents];

  const cases = [];
  let guard = 0;
  let poolIdx = 0;
  let i = cycle * 17;
  while (cases.length < count && guard < count * intents.length * 3) {
    guard += 1;
    const pool = pools[poolIdx % pools.length];
    poolIdx += 1;
    if (!pool.length) continue;
    const row = pool[i % pool.length];
    i += 1;
    const query = String(row.intent_description || row.intent_text || '').trim();
    if (!query || used.has(query.toLowerCase())) continue;
    if (isCommandLikeIntent(query)) continue;
    if (row.example && normalizeExample(query).toLowerCase() === normalizeExample(row.example).toLowerCase()) {
      continue;
    }
    used.add(query.toLowerCase());
    const idHash = createHash('sha256').update(`${seed}:${cycle}:${query}`).digest('hex').slice(0, 8);
    const caseRow = {
      id: `gen-c${cycle}-${idHash}`,
      query,
      expectedCommand: row.command,
      expectedExample: row.example || row.command,
      acceptableCommands: [row.command].filter(Boolean),
      acceptableExamples: [row.example || row.command].filter(Boolean),
      expectedSimplestExample: row.example || row.command,
      preferSimplest: Number(row.simplicity_rank ?? 1) === 1,
      expectedSkillBand: [row.skill_level, row.skill_level],
      judgeNotes: `Generated cycle ${cycle} from catalog intent`,
      tags: ['generated', `cycle-${cycle}`, row.topic || 'git'],
      source: 'catalog-intent',
      cycle,
    };
    if (row.recipe_id) caseRow.expectedRecipeId = row.recipe_id;
    cases.push(caseRow);
  }
  if (cases.length < count) {
    throw new Error(`Could only generate ${cases.length}/${count} unique cases`);
  }
  return cases;
}

/**
 * Catalog topic/command vocabulary for focus prompts.
 * @param {object[]} intents
 */
export function catalogAreasFromIntents(intents = []) {
  const topics = new Set();
  const commands = new Set();
  for (const row of intents || []) {
    if (row.topic) topics.add(String(row.topic));
    if (row.command) commands.add(normalizeExample(row.command));
  }
  return {
    topics: [...topics].sort(),
    commands: [...commands].sort(),
  };
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
 * Cycles 1..N: each must pass golden + ÔëÑnewCasesPerCycle generated cases.
 * Final gate: golden + ALL accumulated generated cases.
 * On final failure ÔåÆ reset to cycle 0 and start over.
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

/**
 * @param {object} state
 * @param {{ golden: object[], intents: object[], focus?: { focusTopics?: string[], focusCommands?: string[] } | null }} ctx
 */
export function nextCyclePlan(state, { golden, intents, focus = null }) {
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
  const prior = priorCasesForCycle(state, golden);
  const generated = generateNewCasesFromIntents(intents, {
    count: state.newCasesPerCycle,
    cycle,
    seed: `attempt-${state.attempt}`,
    excludeQueries: prior.map((c) => c.query),
    preferTopics: focus?.focusTopics || [],
    preferCommands: focus?.focusCommands || [],
  });
  return {
    type: 'cycle',
    cycle,
    generated,
    focus: focus || null,
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
      // failed cycle ÔÇö restart entire 5+final
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
    let actual = { command: null, example: null, skill_level: null, intent_description: null };
    try {
      const r = await searchFn(c.query);
      const top = r?.results?.[0];
      if (top) {
        actual = {
          command: top.command,
          example: top.example ?? top.primary_example ?? top.command,
          skill_level: top.skill_level,
          intent_description: top.intent_description,
          simplicity_rank: top.simplicity_rank,
          recipe_id: top.recipe_id || top.id,
          id: top.recipe_id || top.id,
          commands: top.commands,
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
      expectedExample: c.expectedExample,
      actualCommand: actual.command,
      actualExample: actual.example,
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
