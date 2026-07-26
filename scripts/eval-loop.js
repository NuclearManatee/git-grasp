#!/usr/bin/env bun
/**
 * Eval loop: 5 cycles (golden + ≥30 new each) then final gate (golden + all generated).
 * Final failure restarts the entire 5+final sequence.
 *
 *   --mock-judge          use deterministic gradeCase (no LLM judge)
 *   --stop-after-cycle    exit after the first cycle (for assessment)
 *   --min-pass-rate=0.9
 *   --fresh               reset loop state
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '@git-help/core';
import { loadEnv, requireLlmKey } from '@git-help/core/lib/env.js';
import { llmJsonObject } from '@git-help/core/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '@git-help/core/lib/rateLimit.js';
import { search } from '@git-help/core';
import {
  EVAL_LOOP_DEFAULTS,
  loadGoldenCases,
  loadIntentsJsonl,
  intentsForEvalGeneration,
  loadEvalLoopState,
  saveEvalLoopState,
  createEvalLoopState,
  nextCyclePlan,
  applyEvalResult,
  runCaseSuite,
  priorCasesForCycle,
  summarizeCoveredAreas,
  catalogAreasFromIntents,
  buildEvalFocusPrompt,
} from '@git-help/core/eval/loop.js';
import { gradeCase, migrateGoldenCase } from '@git-help/core/eval/judge.js';
import { DEFAULT_GLOSSARY } from '@git-help/core/catalog/step0Glossary.js';

loadEnv();

const args = process.argv.slice(2);
const useMockJudge = args.includes('--mock-judge') || process.env.GIT_HELP_MOCK_JUDGE === '1';
const forceMockEmb = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1' || args.includes('--mock-embed');
const stopAfterCycle = args.includes('--stop-after-cycle');
const minPass = Number(args.find((a) => a.startsWith('--min-pass-rate='))?.split('=')[1]
  ?? EVAL_LOOP_DEFAULTS.minPassRate);
const maxAttempts = Number(args.find((a) => a.startsWith('--max-attempts='))?.split('=')[1] ?? 3);

const outDir = path.join(PACKAGE_ROOT, 'local', 'eval');
mkdirSync(outDir, { recursive: true });
const statePath = path.join(outDir, 'loop-state.json');
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
const intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl');
const recipesPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.json');
const criteriaPath = path.join(PACKAGE_ROOT, 'eval', 'judge', 'criteria.md');
const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const criteria = existsSync(criteriaPath) ? readFileSync(criteriaPath, 'utf8') : '';
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const golden = loadGoldenCases(goldenPath).map((c) => migrateGoldenCase(c, glossary));
const recipes = existsSync(recipesPath) ? JSON.parse(readFileSync(recipesPath, 'utf8')) : [];
let intents = intentsForEvalGeneration(loadIntentsJsonl(intentsPath), recipes);
if (intents.length === 0) {
  intents = golden.map((g) => ({
    command: g.expectedCommand,
    example: g.expectedExample || g.expectedCommand,
    skill_level: g.expectedSkillBand?.[0] ?? 3,
    intent_description: g.query,
    topic: g.tags?.[0] || 'git',
    recipe_id: g.expectedRecipeId || '',
    simplicity_rank: 1,
  }));
}

const lim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  checkpointPath: path.join(outDir, 'judge-checkpoint.json'),
});

async function proposeCycleFocus(state, cycle) {
  if (useMockJudge) return null;
  const prior = priorCasesForCycle(state, golden);
  // Prior = golden + accumulated generated. LLM is told to concentrate on other areas.
  requireLlmKey();
  const covered = summarizeCoveredAreas(prior);
  const catalog = catalogAreasFromIntents(intents);
  const prompt = buildEvalFocusPrompt(covered, catalog, {
    cycle,
    count: state.newCasesPerCycle,
  });
  try {
    const messages = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ];
    const out = await lim.schedule(() => llmJsonObject({ messages }), {
      estimatedTokens: estimateTokensFromMessages(messages) + 300,
    });
    const focus = {
      focusTopics: Array.isArray(out.focusTopics) ? out.focusTopics.map(String) : [],
      focusCommands: Array.isArray(out.focusCommands) ? out.focusCommands.map(String) : [],
      rationale: String(out.rationale || ''),
    };
    writeFileSync(
      path.join(outDir, `focus-cycle-${cycle}-attempt-${state.attempt}.json`),
      `${JSON.stringify({
        covered: {
          queryCount: covered.queries.length,
          topics: covered.topics,
          commands: covered.commands,
        },
        focus,
      }, null, 2)}\n`,
    );
    console.log(
      `Focus cycle-${cycle}: topics=${focus.focusTopics.slice(0, 6).join(',') || '(none)'} `
      + `commands=${focus.focusCommands.slice(0, 6).join(',') || '(none)'}`,
    );
    return focus;
  } catch (e) {
    console.warn(`Focus proposal failed (falling back to unguided sample): ${e.message}`);
    return null;
  }
}

async function judgeFn(c, actual) {
  if (c.expectedRecipeId) {
    const det = gradeCase(c, actual, glossary);
    if (det.pass) return det;
  }
  if (useMockJudge) {
    return gradeCase(c, actual, glossary);
  }
  requireLlmKey();
  const messages = [
    {
      role: 'system',
      content: `You are a strict grader for git-help. ${criteria}\nReturn JSON {score:1-5, pass:boolean, passAt3:boolean, passAt5:boolean, rationale:string}.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        query: c.query,
        expectedRecipeId: c.expectedRecipeId,
        expectedCommand: c.expectedCommand,
        expectedExample: c.expectedExample,
        acceptableCommands: c.acceptableCommands || [],
        acceptableExamples: c.acceptableExamples || [],
        preferSimplest: c.preferSimplest,
        expectedSimplestExample: c.expectedSimplestExample,
        actualCommand: actual.command,
        actualExample: actual.example,
        actualRecipeId: actual.recipe_id || actual.id,
        expectedSkillBand: c.expectedSkillBand,
        actualSkillLevel: actual.skill_level,
        judgeNotes: c.judgeNotes,
        intent_description: actual.intent_description,
      }),
    },
  ];
  const out = await lim.schedule(() => llmJsonObject({ messages }), {
    estimatedTokens: estimateTokensFromMessages(messages) + 400,
  });
  return {
    score: Number(out.score) || 1,
    pass: Boolean(out.pass),
    passAt3: out.passAt3 != null ? Boolean(out.passAt3) : Boolean(out.pass) || Number(out.score) >= 3,
    passAt5: out.passAt5 != null ? Boolean(out.passAt5) : Boolean(out.pass) && Number(out.score) >= 5,
    rationale: out.rationale || '',
  };
}

async function searchFn(query) {
  return search(query, {
    forceMockEmbeddings: forceMockEmb,
    skillLevelOverride: null,
  });
}

// Fresh cycle-1 assessment: reset state when stopping after one cycle
if (stopAfterCycle || args.includes('--fresh')) {
  const fresh = createEvalLoopState({ ...EVAL_LOOP_DEFAULTS, minPassRate: minPass });
  saveEvalLoopState(statePath, fresh);
}

let state = loadEvalLoopState(statePath, { ...EVAL_LOOP_DEFAULTS, minPassRate: minPass });
state.minPassRate = minPass;

console.log(`Eval loop start attempt=${state.attempt} completedCycles=${state.completedCycles} phase=${state.phase}`);
console.log(`Intents for generation: ${intents.length}`);

while (state.attempt <= maxAttempts) {
  if (state.phase === 'done') break;

  let focus = null;
  if (state.phase === 'cycle' && state.completedCycles < state.requiredCycles) {
    focus = await proposeCycleFocus(state, state.completedCycles + 1);
  }

  const plan = nextCyclePlan(state, { golden, intents, focus });
  if (plan.type === 'done') break;

  console.log(`\n=== ${plan.label} cases=${plan.cases.length} type=${plan.type} ===`);
  const report = await runCaseSuite(plan.cases, { searchFn, judgeFn });
  writeFileSync(
    path.join(outDir, `report-${plan.label}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`passRate=${report.passRate.toFixed(3)} avgScore=${report.avgScore.toFixed(2)} passed=${report.passed}/${report.total}`);

  const applied = applyEvalResult(state, plan, report);
  state = applied.state;
  saveEvalLoopState(statePath, state);

  if (stopAfterCycle && plan.type === 'cycle') {
    const fails = report.cases.filter((c) => !c.pass);
    writeFileSync(
      path.join(outDir, 'cycle-1-failures.json'),
      `${JSON.stringify(fails, null, 2)}\n`,
    );
    console.log(`\nStopped after cycle (--stop-after-cycle). Failures: ${fails.length}`);
    process.exit(report.passRate >= minPass ? 0 : 1);
  }

  if (applied.done) {
    console.log('Eval loop DONE — final gate passed');
    writeFileSync(path.join(outDir, 'eval-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
  }
  if (applied.restart) {
    console.warn(`Gate failed — restarting 5+final (attempt ${state.attempt})`);
    continue;
  }
}

if (state.phase === 'done') {
  process.exit(0);
}
console.error('Eval loop did not complete successfully');
process.exit(1);
