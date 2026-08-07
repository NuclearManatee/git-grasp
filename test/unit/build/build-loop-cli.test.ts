import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseBuildLoopArgs,
  buildLoopOptsFromResolved,
  BUILD_LOOP_HELP,
} from '../../../common/src/build/buildLoopCli.ts';
import {
  createBuildPipelineRunDir,
  createPipelineRunLogger,
} from '../../../common/src/build/pipelineRunLog.ts';
import {
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT_DISPLAY_RATE,
} from '../../../common/src/db/constants.ts';

describe('parseBuildLoopArgs', () => {
  it('exposes help', () => {
    expect(parseBuildLoopArgs(['--help']).help).toBe(true);
    expect(BUILD_LOOP_HELP).toContain('--min-pass-rate');
  });

  it('defaults gates from constants and respects overrides', () => {
    const { resolved } = parseBuildLoopArgs([], { hasStaging: true });
    expect(resolved.fresh).toBe(false);
    expect(resolved.resume).toBe(true);
    expect(resolved.minPassRate).toBe(EVAL_MIN_PASS_RATE);
    expect(resolved.minHitAtDisplayRate).toBe(EVAL_MIN_HIT_AT_DISPLAY_RATE);

    const over = parseBuildLoopArgs(
      [
        '--fresh',
        '--min-pass-rate=0.8',
        '--min-hit-at-display=0.65',
        '--judge-utility=0.88',
        '--max-iterations=200',
        '--concurrency=8',
        '--eval-concurrency=16',
        '--skip-eval-improve',
        '--polish-miss-min=3',
        '--polish-pass-a=0.9',
        '--continue-on-eval-ko',
      ],
      { hasStaging: true },
    ).resolved;
    expect(over.fresh).toBe(true);
    expect(over.minPassRate).toBe(0.8);
    expect(over.minHitAtDisplayRate).toBe(0.65);
    expect(over.utilityThreshold).toBe(0.88);
    expect(over.maxIterations).toBe(200);
    expect(over.concurrency).toBe(8);
    expect(over.evalConcurrency).toBe(16);
    expect(over.skipEvalImprove).toBe(true);
    expect(over.polishMissMin).toBe(3);
    expect(over.polishPassA).toBe(0.9);
    expect(over.continueOnEvalKo).toBe(true);

    const opts = buildLoopOptsFromResolved(over);
    expect(opts.minPassRate).toBe(0.8);
    expect(opts.maxIterations).toBe(200);
    expect(opts.skipEvalImprove).toBe(true);
  });

  it('parses gap-check and coverage insert caps', () => {
    const { resolved } = parseBuildLoopArgs(
      ['--eval-gap-check-max=7', '--eval-coverage-max-inserts=2'],
      { hasStaging: true },
    );
    expect(resolved.evalGapCheckMax).toBe(7);
    expect(resolved.evalCoverageMaxInserts).toBe(2);
    const opts = buildLoopOptsFromResolved(resolved);
    expect(opts.evalGapCheckMax).toBe(7);
    expect(opts.evalCoverageMaxInserts).toBe(2);
    expect(BUILD_LOOP_HELP).toContain('--eval-gap-check-max');
    expect(BUILD_LOOP_HELP).toContain('--eval-coverage-max-inserts');
  });

  it('auto-fresh when staging missing unless --resume', () => {
    expect(parseBuildLoopArgs([], { hasStaging: false }).resolved.fresh).toBe(true);
    expect(parseBuildLoopArgs(['--resume'], { hasStaging: false }).resolved.fresh).toBe(
      false,
    );
  });
});

describe('pipelineRunLog', () => {
  it('writes config, eval report, and summary under run dir', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'build-pipeline-'));
    const { runDir, startedAt } = createBuildPipelineRunDir({
      startedAt: new Date('2026-08-02T10:00:00.000Z'),
      runDir: path.join(root, 'run_test'),
    });
    const logger = createPipelineRunLogger({
      runDir,
      startedAt,
      config: { minPassRate: 0.85, fresh: true },
    });
    logger.onBuildLog('[build 10:00:01] hello');
    logger.onEvalReport(
      {
        ok: false,
        okHit: true,
        okPass: false,
        passed: 1,
        hitPassed: 1,
        total: 2,
        rate: 0.5,
        hitRate: 0.5,
        results: [
          { pass: true, via: 'hit@display', query: { command_id: 1, query_text: 'a' } },
          {
            pass: false,
            via: 'ko',
            utility: 0.2,
            reason: 'no',
            query: { command_id: 2, query_text: 'b', primary_verb: 'git status' },
            displayed: [{ command_id: 9, example: 'git log' }],
          },
        ],
      },
      { phase: 'ground' },
    );
    const summary = logger.finalize({
      ok: false,
      phase: 'ground',
      message: 'Eval KO',
      eval: { ok: false, rate: 0.5, total: 2, passed: 1 },
    });

    expect(existsSync(path.join(runDir, 'config.json'))).toBe(true);
    expect(existsSync(path.join(runDir, 'console.log'))).toBe(true);
    expect(existsSync(path.join(runDir, 'phases', 'ground', 'eval-report.json'))).toBe(
      true,
    );
    expect(summary.ok).toBe(false);
    expect(summary.phases).toHaveLength(1);
    const report = JSON.parse(
      readFileSync(path.join(runDir, 'phases', 'ground', 'eval-report.json'), 'utf8'),
    );
    expect(report.missCount).toBe(1);
    expect(report.misses[0].query_text).toBe('b');
    const consoleText = readFileSync(path.join(runDir, 'console.log'), 'utf8');
    expect(consoleText).toContain('hello');
    rmSync(root, { recursive: true, force: true });
  });
});
