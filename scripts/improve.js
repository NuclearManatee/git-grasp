#!/usr/bin/env bun
/**
 * Scripted improve loop (no LLM code edits).
 * Must run on improve/* branch, not main.
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, defaultThresholdsPath } from '@git-help/core';
import { loadEnv } from '@git-help/core/lib/env.js';

loadEnv();

const args = process.argv.slice(2);
const maxIter = Number(args.find((a) => a.startsWith('--max-iterations='))?.split('=')[1] ?? 10);
const dryRun = args.includes('--dry-run');
const allowReseed = args.includes('--allow-full-reseed');
const useMockEval = args.includes('--mock') || process.env.GIT_HELP_MOCK_JUDGE === '1';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch === 'main' || branch === 'master') {
  console.error('Refuse to run improve on main/master. Checkout improve/* first.');
  process.exit(1);
}
if (!branch.startsWith('improve/') && !args.includes('--force-branch')) {
  console.error(`Branch ${branch} should be improve/*. Pass --force-branch to override.`);
  process.exit(1);
}

const outDir = path.join(PACKAGE_ROOT, 'local', 'improve');
mkdirSync(outDir, { recursive: true });
const checkpointPath = path.join(outDir, 'checkpoint.json');
let checkpoint = existsSync(checkpointPath)
  ? JSON.parse(readFileSync(checkpointPath, 'utf8'))
  : { iteration: 0, bestPassRate: 0, bestAvg: 0 };

const thresholdsPath = defaultThresholdsPath();
const grid = [
  { minScore: 0.25, maxSecondGap: 0.04, lowConfidenceScore: 0.4, topK: 5 },
  { minScore: 0.3, maxSecondGap: 0.05, lowConfidenceScore: 0.45, topK: 5 },
  { minScore: 0.35, maxSecondGap: 0.06, lowConfidenceScore: 0.5, topK: 8 },
  { minScore: 0.2, maxSecondGap: 0.03, lowConfidenceScore: 0.35, topK: 5, normalizeQuery: true },
  { minScore: 0.35, maxSecondGap: 0.05, lowConfidenceScore: 0.45, topK: 5, normalizeQuery: false },
];

function runTests() {
  execSync('npm test', {
    stdio: 'inherit',
    env: { ...process.env, GIT_HELP_MOCK_EMBEDDINGS: '1', GIT_HELP_SKIP_POSTINSTALL: '1' },
  });
}

function runEval() {
  if (useMockEval) {
    execSync('node scripts/eval.js --mock-judge --mock-embed', {
      stdio: 'inherit',
      env: { ...process.env, GIT_HELP_MOCK_EMBEDDINGS: '1', GIT_HELP_MOCK_JUDGE: '1' },
      cwd: PACKAGE_ROOT,
    });
  } else {
    console.log('Running real Groq eval (no mock embeddings)…');
    const env = { ...process.env };
    delete env.GIT_HELP_MOCK_EMBEDDINGS;
    delete env.GIT_HELP_MOCK_JUDGE;
    execSync('node scripts/eval.js --min-pass-rate=0', {
      stdio: 'inherit',
      env,
      cwd: PACKAGE_ROOT,
    });
  }
  const report = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'local', 'eval', 'eval-report.json'), 'utf8'));
  return report;
}

function commit(msg) {
  if (dryRun) {
    console.log(`[dry-run] commit: ${msg}`);
    return;
  }
  try {
    execSync('git add config/thresholds.json', { stdio: 'inherit', cwd: PACKAGE_ROOT });
    if (existsSync(path.join(PACKAGE_ROOT, 'data', 'git-commands.db'))) {
      execSync('git add data/git-commands.db data/git-commands.db.sha256', {
        stdio: 'inherit',
        cwd: PACKAGE_ROOT,
      });
    }
  } catch {
    /* ignore add errors */
  }
  try {
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}" -m "Made-with: git-help-improve"`, {
      stdio: 'inherit',
      cwd: PACKAGE_ROOT,
    });
  } catch {
    console.log('Nothing to commit');
  }
}

const start = checkpoint.iteration || 0;
for (let i = start; i < maxIter; i += 1) {
  console.log(`\n=== improve iteration ${i + 1}/${maxIter} ===`);
  const params = grid[i % grid.length];
  const prev = JSON.parse(readFileSync(thresholdsPath, 'utf8'));
  const next = { ...prev, ...params, schemaVersion: 1 };
  const backup = `${thresholdsPath}.bak`;
  copyFileSync(thresholdsPath, backup);
  writeFileSync(thresholdsPath, `${JSON.stringify(next, null, 2)}\n`);

  if (!dryRun) {
    try {
      runTests();
    } catch {
      copyFileSync(backup, thresholdsPath);
      console.error('Tests failed; restored thresholds');
      process.exit(1);
    }
  }

  let report;
  try {
    report = runEval();
  } catch (e) {
    if (e.status === 20) {
      checkpoint.iteration = i;
      checkpoint.state = 'paused_rate_limit';
      writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
      process.exit(20);
    }
    copyFileSync(backup, thresholdsPath);
    throw e;
  }

  const better = report.passRate > (checkpoint.bestPassRate || 0)
    || (report.passRate === checkpoint.bestPassRate && report.avgScore > (checkpoint.bestAvg || 0));

  if (better) {
    checkpoint.bestPassRate = report.passRate;
    checkpoint.bestAvg = report.avgScore;
    checkpoint.iteration = i + 1;
    checkpoint.state = 'improved_commit';
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    commit(`improve(loop): thresholds passRate=${report.passRate.toFixed(3)}`);
    if (report.passRate >= 0.9) {
      checkpoint.state = 'target_met';
      writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
      console.log('Target met');
      process.exit(0);
    }
  } else {
    copyFileSync(backup, thresholdsPath);
    mkdirSync(path.join(PACKAGE_ROOT, 'local', 'eval'), { recursive: true });
    writeFileSync(
      path.join(PACKAGE_ROOT, 'local', 'eval', 'regress-report.md'),
      `# Regress iteration ${i + 1}\npassRate=${report.passRate}\n`,
    );
    checkpoint.state = 'regressed_report';
    checkpoint.iteration = i + 1;
    writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
    console.log('Regressed — discarded threshold change');
  }

  if (allowReseed && i === maxIter - 1) {
    console.log('Reseed flag set — run build-catalog && seed manually on this branch if desired');
  }
}

checkpoint.state = 'max_iterations';
writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
console.log('Max iterations reached');
