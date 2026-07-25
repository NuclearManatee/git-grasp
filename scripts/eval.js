#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath, defaultThresholdsPath } from '../src/lib/paths.js';
import { search } from '../src/search/index.js';
import { loadEnv, requireLlmKey } from '../src/lib/env.js';
import { llmJsonObject } from '../src/lib/llm.js';
import { createRateLimiter, estimateTokensFromMessages } from '../src/lib/rateLimit.js';

loadEnv();

const args = process.argv.slice(2);
const minPass = Number(args.find((a) => a.startsWith('--min-pass-rate='))?.split('=')[1] ?? '0');
const useMockJudge = args.includes('--mock-judge') || process.env.GIT_HELP_MOCK_JUDGE === '1';
const forceMockEmb = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1' || args.includes('--mock-embed');

const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
const criteriaPath = path.join(PACKAGE_ROOT, 'eval', 'judge', 'criteria.md');
const outDir = path.join(PACKAGE_ROOT, 'local', 'eval');
mkdirSync(outDir, { recursive: true });

const cases = JSON.parse(readFileSync(goldenPath, 'utf8'));
const criteria = existsSync(criteriaPath) ? readFileSync(criteriaPath, 'utf8') : '';

const lim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  checkpointPath: path.join(PACKAGE_ROOT, 'local', 'eval', 'judge-checkpoint.json'),
});

async function judgeCase(c, actual) {
  if (useMockJudge) {
    const ok = [c.expectedCommand, ...(c.acceptableCommands || [])].some(
      (x) => actual.command === x || actual.command?.startsWith(x.split(' <')[0]),
    );
    const soft = actual.command && c.expectedCommand
      && actual.command.split(/\s+/).slice(0, 2).join(' ') === c.expectedCommand.split(/\s+/).slice(0, 2).join(' ');
    const pass = ok || soft;
    return { score: pass ? 5 : 2, pass, rationale: pass ? 'mock pass' : 'mock fail' };
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
    estimatedTokens: estimateTokensFromMessages(messages) + 400,
  });
}

const results = [];
let passed = 0;
let scoreSum = 0;

for (const c of cases) {
  let actual = { command: null, skill_level: null, intent_description: null };
  try {
    const r = await search(c.query, {
      forceMockEmbeddings: forceMockEmb,
      skillLevelOverride: null,
    });
    const top = r.results[0];
    if (top) {
      actual = {
        command: top.command,
        skill_level: top.skill_level,
        intent_description: top.intent_description,
      };
    }
  } catch (err) {
    actual = { command: null, skill_level: null, intent_description: null, error: err.message };
  }

  let judgment;
  try {
    judgment = await judgeCase(c, actual);
  } catch (e) {
    if (e.code === 'RATE_LIMIT_PAUSE') {
      console.error('Judge rate-limit pause — re-run eval');
      process.exit(20);
    }
    throw e;
  }
  const pass = Boolean(judgment.pass);
  if (pass) passed += 1;
  scoreSum += Number(judgment.score) || 0;
  results.push({ id: c.id, pass, score: judgment.score, rationale: judgment.rationale, actual });
}

const passRate = cases.length ? passed / cases.length : 0;
const report = {
  passRate,
  passed,
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
console.log(JSON.stringify({ passRate, passed, total: cases.length, gate: report.gate }, null, 2));
process.exit(report.gate || minPass === 0 ? 0 : 1);
