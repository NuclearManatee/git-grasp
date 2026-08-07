// @ts-nocheck
/**
 * CLI / opts defaults for interactive build:loop (tunable gates + loop knobs).
 */
import {
  EVAL_MIN_PASS_RATE,
  EVAL_MIN_HIT_AT_DISPLAY_RATE,
  EVAL_JUDGE_UTILITY_THRESHOLD,
  EVAL_CONCURRENCY,
  EVAL_SEARCH_POOL_SIZE,
  BUILD_CONCURRENCY,
  LOOP_EXIT_ZERO_STREAK,
  LOOP_MAX_BATCH,
  EVAL_IMPROVE_POLISH_MISS_MIN,
  EVAL_IMPROVE_POLISH_PASS_A,
  EVAL_GATE_FAIL_RETRY_MAX,
  EVAL_GATE_POLISH_RETRY_MAX,
  EVAL_GATE_MIN_BANK_TOTAL,
  EVAL_GATE_MIN_BANK_COMPOSITION,
  EVAL_GAP_CHECK_MAX,
  EVAL_COVERAGE_MAX_INSERTS,
} from '../db/constants.js';

export const BUILD_LOOP_HELP = `Usage: bun apps/pipeline/src/build-loop.ts [options]

Mode:
  --fresh                 Wipe staging + eval banks, run ground then loop (default if no staging)
  --resume                Resume loop only (ignore auto-fresh when staging missing fails)

Gates (dual hard gate + judge):
  --min-pass-rate=N       Pass A floor (default ${EVAL_MIN_PASS_RATE})
  --min-hit-at-display=N  Hit@display floor (default ${EVAL_MIN_HIT_AT_DISPLAY_RATE})
  --judge-utility=N       Per-query judge utility >= N (default ${EVAL_JUDGE_UTILITY_THRESHOLD})
  --eval-min-bank-total=N Absolute golden bank floor before binding loop KO (default ${EVAL_GATE_MIN_BANK_TOTAL})
  --eval-min-bank-composition=N Composition golden floor (default ${EVAL_GATE_MIN_BANK_COMPOSITION})

Loop:
  --max-iterations=N      Cap evolve cycles (default 100, or staging meta on resume)
  --post-floor-iterations=N  After bank floors met, run N more iters then stop (disabled if unset)
  --exit-zero-streak=N    Stop after N consecutive zero-unique cycles (default ${LOOP_EXIT_ZERO_STREAK})
  --batch-size=N          Evolve parent batch cap (default ${LOOP_MAX_BATCH})
  --concurrency=N         Ground/evolve job concurrency (default ${BUILD_CONCURRENCY})

Eval / improve / recovery:
  --eval-concurrency=N    Parallel eval queries (default ${EVAL_CONCURRENCY})
  --eval-search-pool=N    Readonly SQLite pool for eval search (default ${EVAL_SEARCH_POOL_SIZE})
  --skip-eval-recovery    Disable bank recovery + improve after eval
  --skip-eval-improve     Allow bank rewrite but skip taxonomy improve rounds
  --eval-fail-retry-max=N Fail-retry attempts when gate red (default ${EVAL_GATE_FAIL_RETRY_MAX})
  --eval-polish-retry-max=N Polish attempts when green but below nice (default ${EVAL_GATE_POLISH_RETRY_MAX})
  --polish-miss-min=N     Polish if misses >= N (default ${EVAL_IMPROVE_POLISH_MISS_MIN})
  --polish-pass-a=N       Polish if Pass A < N / nice-to-have (default ${EVAL_IMPROVE_POLISH_PASS_A})
  --eval-gap-check-max=N  Max LLM gap-checks per recovery attempt (default ${EVAL_GAP_CHECK_MAX})
  --eval-coverage-max-inserts=N Max coverage-gap inserts per attempt (default ${EVAL_COVERAGE_MAX_INSERTS})
  --continue-on-eval-ko   Do not stop the run when a gate fails

Logging:
  --run-dir=PATH          Explicit run artifact directory (default local/build-pipeline/run_<ts>/)
  --no-run-log            Skip structured run logging under local/build-pipeline/

  --help                  Show this help
`;

function flag(argv, name) {
  return argv.includes(name);
}

function numOpt(argv, name, fallback) {
  const prefix = `${name}=`;
  const raw = argv.find((a) => a.startsWith(prefix));
  if (!raw) return fallback;
  const n = Number(raw.slice(prefix.length));
  return Number.isFinite(n) ? n : fallback;
}

function strOpt(argv, name) {
  const prefix = `${name}=`;
  const raw = argv.find((a) => a.startsWith(prefix));
  if (!raw) return undefined;
  const v = raw.slice(prefix.length).trim();
  return v || undefined;
}

/**
 * @param {string[]} argv process.argv.slice(2) or full argv
 * @param {{ hasStaging?: boolean }} [ctx]
 */
export function parseBuildLoopArgs(argv = process.argv.slice(2), ctx = {}) {
  if (flag(argv, '--help') || flag(argv, '-h')) {
    return { help: true };
  }

  const hasStaging = ctx.hasStaging === true;
  const freshFlag = flag(argv, '--fresh');
  const resumeFlag = flag(argv, '--resume');
  let fresh = freshFlag || (!resumeFlag && !hasStaging);
  if (resumeFlag) fresh = false;

  const maxIterationsRaw = numOpt(argv, '--max-iterations', null);
  const maxIterations =
    maxIterationsRaw == null ? undefined : Math.max(1, Math.floor(maxIterationsRaw));
  const postFloorIterationsRaw = numOpt(argv, '--post-floor-iterations', null);
  const postFloorIterations =
    postFloorIterationsRaw == null
      ? undefined
      : Math.max(0, Math.floor(postFloorIterationsRaw));

  const runDir = strOpt(argv, '--run-dir');
  const noRunLog = flag(argv, '--no-run-log');

  /** @type {Record<string, unknown>} */
  const resolved = {
    fresh,
    resume: !fresh,
    maxIterations: maxIterations ?? null,
    postFloorIterations: postFloorIterations ?? null,
    minPassRate: numOpt(argv, '--min-pass-rate', EVAL_MIN_PASS_RATE),
    minHitAtDisplayRate: numOpt(argv, '--min-hit-at-display', EVAL_MIN_HIT_AT_DISPLAY_RATE),
    utilityThreshold: numOpt(argv, '--judge-utility', EVAL_JUDGE_UTILITY_THRESHOLD),
    exitZeroStreak: Math.max(
      1,
      Math.floor(numOpt(argv, '--exit-zero-streak', LOOP_EXIT_ZERO_STREAK)),
    ),
    batchSize: Math.max(1, Math.floor(numOpt(argv, '--batch-size', LOOP_MAX_BATCH))),
    concurrency: Math.max(1, Math.floor(numOpt(argv, '--concurrency', BUILD_CONCURRENCY))),
    evalConcurrency: Math.max(
      1,
      Math.floor(numOpt(argv, '--eval-concurrency', EVAL_CONCURRENCY)),
    ),
    searchPoolSize: Math.max(
      1,
      Math.floor(numOpt(argv, '--eval-search-pool', EVAL_SEARCH_POOL_SIZE)),
    ),
    skipEvalImprove: flag(argv, '--skip-eval-improve'),
    skipEvalRecovery: flag(argv, '--skip-eval-recovery'),
    evalFailRetryMax: Math.max(
      0,
      Math.floor(numOpt(argv, '--eval-fail-retry-max', EVAL_GATE_FAIL_RETRY_MAX)),
    ),
    evalPolishRetryMax: Math.max(
      0,
      Math.floor(numOpt(argv, '--eval-polish-retry-max', EVAL_GATE_POLISH_RETRY_MAX)),
    ),
    polishMissMin: Math.max(
      0,
      Math.floor(numOpt(argv, '--polish-miss-min', EVAL_IMPROVE_POLISH_MISS_MIN)),
    ),
    polishPassA: numOpt(argv, '--polish-pass-a', EVAL_IMPROVE_POLISH_PASS_A),
    evalMinBankTotal: Math.max(
      1,
      Math.floor(numOpt(argv, '--eval-min-bank-total', EVAL_GATE_MIN_BANK_TOTAL)),
    ),
    evalMinBankComposition: Math.max(
      0,
      Math.floor(
        numOpt(argv, '--eval-min-bank-composition', EVAL_GATE_MIN_BANK_COMPOSITION),
      ),
    ),
    evalGapCheckMax: Math.max(
      0,
      Math.floor(numOpt(argv, '--eval-gap-check-max', EVAL_GAP_CHECK_MAX)),
    ),
    evalCoverageMaxInserts: Math.max(
      0,
      Math.floor(numOpt(argv, '--eval-coverage-max-inserts', EVAL_COVERAGE_MAX_INSERTS)),
    ),
    continueOnEvalKo: flag(argv, '--continue-on-eval-ko'),
    runLog: !noRunLog,
    runDir: runDir || null,
  };

  return { help: false, resolved, argv: [...argv] };
}

/**
 * Map resolved CLI config → runBuildLoop / runGroundStep opts.
 * @param {Record<string, unknown>} resolved
 */
export function buildLoopOptsFromResolved(resolved) {
  return {
    minPassRate: resolved.minPassRate,
    minHitAtDisplayRate: resolved.minHitAtDisplayRate,
    utilityThreshold: resolved.utilityThreshold,
    ...(resolved.maxIterations != null ? { maxIterations: resolved.maxIterations } : {}),
    ...(resolved.postFloorIterations != null
      ? { postFloorIterations: resolved.postFloorIterations }
      : {}),
    exitZeroStreak: resolved.exitZeroStreak,
    batchSize: resolved.batchSize,
    concurrency: resolved.concurrency,
    evalConcurrency: resolved.evalConcurrency,
    searchPoolSize: resolved.searchPoolSize,
    skipEvalImprove: resolved.skipEvalImprove,
    skipEvalRecovery: resolved.skipEvalRecovery,
    evalFailRetryMax: resolved.evalFailRetryMax,
    evalPolishRetryMax: resolved.evalPolishRetryMax,
    polishMissMin: resolved.polishMissMin,
    polishPassA: resolved.polishPassA,
    evalMinBankTotal: resolved.evalMinBankTotal,
    evalMinBankComposition: resolved.evalMinBankComposition,
    evalGapCheckMax: resolved.evalGapCheckMax,
    evalCoverageMaxInserts: resolved.evalCoverageMaxInserts,
    continueOnEvalKo: resolved.continueOnEvalKo,
  };
}
