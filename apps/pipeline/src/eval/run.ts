#!/usr/bin/env bun
// @ts-nocheck
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath, defaultThresholdsPath, goldenCasesPath, judgeCriteriaPath, catalogDir } from '@git-grasp/common';
import { search } from '@git-grasp/common';
import { loadEnv, requireLlmKey } from '@git-grasp/common/lib/env.js';
import { llmJsonObject } from '@git-grasp/common/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '@git-grasp/common/lib/rateLimit.js';
import { gradeCase, migrateGoldenCase } from '@git-grasp/common/eval/judge.js';
import { DEFAULT_GLOSSARY } from '@git-grasp/common/catalog/step0Glossary.js';
import { JudgeResultSchema } from '@git-grasp/common/schemas';

loadEnv();

const args = process.argv.slice(2);
const minPass = Number(args.find((a) => a.startsWith('--min-pass-rate='))?.split('=')[1] ?? '0');
const useMockJudge = args.includes('--mock-judge') || process.env.GIT_GRASP_MOCK_JUDGE === '1';
const forceMockEmb = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1' || args.includes('--mock-embed');

const goldenPath = goldenCasesPath();
const criteriaPath = judgeCriteriaPath();
const glossaryPath = path.join(catalogDir(), 'glossary.json');
const outDir = path.join(PACKAGE_ROOT, 'local', 'eval');
mkdirSync(outDir, { recursive: true });

const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;
const cases = JSON.parse(readFileSync(goldenPath, 'utf8')).map((c) => migrateGoldenCase(c, glossary));
const criteria = existsSync(criteriaPath) ? readFileSync(criteriaPath, 'utf8') : '';

const lim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  checkpointPath: path.join(PACKAGE_ROOT, 'local', 'eval', 'judge-checkpoint.json'),
});

async function judgeCase(c, actual) {
  // Deterministic recipe-id match (workflow goldens) ÔÇö skip LLM.
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
      content: `You are a strict grader for git-grasp. ${criteria}\nReturn JSON {score:1-5, pass:boolean, passAt3:boolean, passAt5:boolean, rationale:string}.`,
    },
    {
      role: 'user',
      content: JSON.stringify({
        query: c.query,
        expectedRecipeId: c.expectedRecipeId,
        acceptableRecipeIds: c.acceptableRecipeIds || [],
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
  const out = await lim.schedule(() => llmJsonObject({ messages, schema: JudgeResultSchema }), {
    estimatedTokens: estimateTokensFromMessages(messages) + 400,
  });
  return out;
}

const results = [];
let passed = 0;
let passedAt3 = 0;
let passedAt5 = 0;
let scoreSum = 0;

for (const c of cases) {
  let actual = { command: null, example: null, skill_level: null, intent_description: null };
  try {
    const r = await search(c.query, {
      forceMockEmbeddings: forceMockEmb,
      skillLevelOverride: null,
    });
    const top = r.results[0];
    if (top) {
      actual = {
        command: top.command,
        example: top.example ?? top.command,
        skill_level: top.skill_level,
        intent_description: top.intent_description,
        simplicity_rank: top.simplicity_rank,
        recipe_id: top.recipe_id || top.id,
        id: top.recipe_id || top.id,
        commands: top.commands,
      };
    }
  } catch (err) {
    actual = {
      command: null,
      example: null,
      skill_level: null,
      intent_description: null,
      error: err.message,
    };
  }

  let judgment;
  try {
    judgment = await judgeCase(c, actual);
  } catch (e) {
    if (e.code === 'RATE_LIMIT_PAUSE') {
      console.error('Judge rate-limit pause ÔÇö re-run eval');
      process.exit(20);
    }
    throw e;
  }
  const pass = Boolean(judgment.pass);
  if (pass) passed += 1;
  if (judgment.passAt3) passedAt3 += 1;
  if (judgment.passAt5) passedAt5 += 1;
  scoreSum += Number(judgment.score) || 0;
  results.push({
    id: c.id,
    pass,
    passAt3: Boolean(judgment.passAt3),
    passAt5: Boolean(judgment.passAt5),
    score: judgment.score,
    rationale: judgment.rationale,
    actual,
  });
}

const passRate = cases.length ? passed / cases.length : 0;
const report = {
  passRate,
  passRateAt3: cases.length ? passedAt3 / cases.length : 0,
  passRateAt5: cases.length ? passedAt5 / cases.length : 0,
  passed,
  passedAt3,
  passedAt5,
  total: cases.length,
  avgScore: cases.length ? scoreSum / cases.length : 0,
  minPassRate: minPass,
  gate: passRate >= minPass,
  db: defaultDbPath(),
  thresholds: defaultThresholdsPath(),
  results,
  createdAt: new Date().toISOString(),
};

writeFileSync(path.join(outDir, 'last-report.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(path.join(outDir, 'eval-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  passRate,
  passRateAt3: report.passRateAt3,
  passRateAt5: report.passRateAt5,
  passed,
  total: cases.length,
  gate: report.gate,
}, null, 2));
process.exit(report.gate || minPass === 0 ? 0 : 1);
