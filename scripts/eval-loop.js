#!/usr/bin/env node
/**
 * Eval loop: 5 cycles (golden + ≥30 new each) then final gate (golden + all generated).
 * Final failure restarts the entire 5+final sequence.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../src/lib/env.js';
import { llmJsonObject } from '../src/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '../src/lib/rateLimit.js';
import { search } from '../src/search/index.js';
import {
  EVAL_LOOP_DEFAULTS,
  loadGoldenCases,
  loadIntentsJsonl,
  loadEvalLoopState,
  saveEvalLoopState,
  nextCyclePlan,
  applyEvalResult,
  runCaseSuite,
} from '../src/eval/loop.js';

loadEnv();

const args = process.argv.slice(2);
const useMockJudge = args.includes('--mock-judge') || process.env.GIT_HELP_MOCK_JUDGE === '1';
const forceMockEmb = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1' || args.includes('--mock-embed');
const minPass = Number(args.find((a) => a.startsWith('--min-pass-rate='))?.split('=')[1]
  ?? EVAL_LOOP_DEFAULTS.minPassRate);
const maxAttempts = Number(args.find((a) => a.startsWith('--max-attempts='))?.split('=')[1] ?? 3);

const outDir = path.join(PACKAGE_ROOT, 'local', 'eval');
mkdirSync(outDir, { recursive: true });
const statePath = path.join(outDir, 'loop-state.json');
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
const intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl');
const criteriaPath = path.join(PACKAGE_ROOT, 'eval', 'judge', 'criteria.md');
const criteria = existsSync(criteriaPath) ? readFileSync(criteriaPath, 'utf8') : '';

const golden = loadGoldenCases(goldenPath);
let intents = loadIntentsJsonl(intentsPath);
if (intents.length === 0) {
  intents = golden.map((g) => ({
    command: g.expectedCommand,
    skill_level: g.expectedSkillBand?.[0] ?? 3,
    intent_description: g.query,
    topic: g.tags?.[0] || 'git',
  }));
}

const lim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  checkpointPath: path.join(outDir, 'judge-checkpoint.json'),
});

async function judgeFn(c, actual) {
  if (useMockJudge) {
    const ok = [c.expectedCommand, ...(c.acceptableCommands || [])].some(
      (x) => actual.command === x
        || (actual.command && x && actual.command.split(/\s+/).slice(0, 2).join(' ') === x.split(/\s+/).slice(0, 2).join(' ')),
    );
    return { score: ok ? 5 : 2, pass: ok, rationale: ok ? 'mock pass' : 'mock fail' };
  }
  requireLlmKey();
  const messages = [
    { role: 'system', content: `You are a strict grader for git-help. ${criteria}\nReturn JSON {score:1-5, pass:boolean, rationale:string}.` },
    {
      role: 'user',
      content: JSON.stringify({
        query: c.query,
        expectedCommand: c.expectedCommand,
        acceptableCommands: c.acceptableCommands || [],
        actualCommand: actual.command,
        expectedSkillBand: c.expectedSkillBand,
        actualSkillLevel: actual.skill_level,
        judgeNotes: c.judgeNotes,
        intent_description: actual.intent_description,
      }),
    },
  ];
  return lim.schedule(() => llmJsonObject({ messages }), {
    estimatedTokens: estimateTokensFromMessages(messages),
  });
}

async function searchFn(query) {
  return search(query, {
    forceMockEmbeddings: forceMockEmb,
    skillLevelOverride: null,
  });
}

let state = loadEvalLoopState(statePath, { ...EVAL_LOOP_DEFAULTS, minPassRate: minPass });
state.minPassRate = minPass;

console.log(`Eval loop start attempt=${state.attempt} completedCycles=${state.completedCycles} phase=${state.phase}`);

while (state.attempt <= maxAttempts) {
  if (state.phase === 'done') break;

  const plan = nextCyclePlan(state, { golden, intents });
  if (plan.type === 'done') break;

  console.log(`\n=== ${plan.label} cases=${plan.cases.length} type=${plan.type} ===`);
  const report = await runCaseSuite(plan.cases, { searchFn, judgeFn });
  writeFileSync(
    path.join(outDir, `report-${plan.label}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`passRate=${report.passRate.toFixed(3)} avgScore=${report.avgScore.toFixed(2)}`);

  const applied = applyEvalResult(state, plan, report);
  state = applied.state;
  saveEvalLoopState(statePath, state);

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
