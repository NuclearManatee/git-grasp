#!/usr/bin/env node
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath, defaultThresholdsPath } from '../src/lib/paths.js';
import { search } from '../src/search/index.js';
import { loadEnv, requireGroqKey } from '../src/lib/env.js';
import { groqJson } from '../src/lib/groq.js';
import { SerialRateLimiter } from '../src/lib/rateLimit.js';

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

const lim = new SerialRateLimiter({
  minIntervalMs: 1200,
  checkpointPath: path.join(PACKAGE_ROOT, 'local', 'eval', 'judge-checkpoint.json'),
});

async function judgeCase(c, actual) {
  if (useMockJudge) {
    const ok = [c.expectedCommand, ...(c.acceptableCommands || [])].some(
      (x) => actual.command === x || actual.command?.startsWith(x.split(' <')[0]),
    );
    // Also soft-match: same first two tokens
    const soft = actual.command && c.expectedCommand
      && actual.command.split(/\s+/).slice(0, 2).join(' ') === c.expectedCommand.split(/\s+/).slice(0, 2).join(' ');
    const pass = ok || soft;
    return { score: pass ? 5 : 2, pass, rationale: pass ? 'mock pass' : 'mock fail' };
  }
  requireGroqKey();
  return lim.schedule(() => groqJson({
    messages: [
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
    ],
  }));
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
  } catch (e) {
    actual = { command: null, skill_level: null, intent_description: null, error: e.message };
  }

  let verdict;
  try {
    verdict = await judgeCase(c, actual);
  } catch (e) {
    if (e.code === 'RATE_LIMIT_PAUSE') {
      writeReports(results, passed, scoreSum, cases.length);
      console.error('Rate limit pause');
      process.exit(20);
    }
    verdict = { score: 1, pass: false, rationale: `judge_error: ${e.message}` };
  }

  if (verdict.pass) passed += 1;
  scoreSum += Number(verdict.score) || 0;
  results.push({
    id: c.id,
    query: c.query,
    expectedCommand: c.expectedCommand,
    actualCommand: actual.command,
    pass: Boolean(verdict.pass),
    score: verdict.score,
    rationale: verdict.rationale,
  });
}

const passRate = cases.length ? passed / cases.length : 0;
const avgScore = cases.length ? scoreSum / cases.length : 0;
writeReports(results, passed, scoreSum, cases.length);

console.log(`passRate=${passRate.toFixed(3)} avgScore=${avgScore.toFixed(2)} (${passed}/${cases.length})`);

if (minPass > 0 && passRate < minPass) {
  console.error(`Below min pass rate ${minPass}`);
  process.exit(1);
}

function writeReports(results, passed, scoreSum, total) {
  const passRate = total ? passed / total : 0;
  const avgScore = total ? scoreSum / total : 0;
  const report = {
    schemaVersion: 1,
    passRate,
    avgScore,
    cases: results,
  };
  writeFileSync(path.join(outDir, 'eval-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  const fails = results.filter((r) => !r.pass);
  const md = [
    '# Eval failures',
    '',
    ...fails.map((f) => `## ${f.id}\n- query: ${f.query}\n- expected: \`${f.expectedCommand}\`\n- actual: \`${f.actualCommand}\`\n- ${f.rationale}\n`),
  ].join('\n');
  writeFileSync(path.join(outDir, 'failures.md'), md);
}
