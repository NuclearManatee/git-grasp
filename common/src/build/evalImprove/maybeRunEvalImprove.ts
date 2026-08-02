// @ts-nocheck
/**
 * Policy wrapper: when to run one improve round after an eval.
 */
import {
  EVAL_IMPROVE_POLISH_MISS_MIN,
  EVAL_IMPROVE_POLISH_PASS_A,
} from '../../db/constants.js';
import { countEvalMisses } from './collectMisses.js';
import { runImproveRound } from './runImproveRound.js';

/**
 * @param {{
 *   evalResult: object,
 *   phase?: string,
 *   skipEvalImprove?: boolean,
 *   stagingPath: string,
 *   embedder: object,
 *   bank: object[],
 *   runBankEval: Function,
 *   taxonomyVerbs?: string[],
 *   verbLookup?: object,
 *   llmJsonObject?: Function,
 *   trapsPath?: string,
 *   familiesPath?: string,
 *   expandIntents?: Function,
 *   minPassRate?: number,
 *   minHitAtDisplayRate?: number,
 *   searchFn?: Function,
 *   evalConcurrency?: number,
 *   log?: (m: string) => void,
 * }} opts
 */
export function shouldRunEvalImprove(evalResult, opts = {}) {
  if (opts.skipEvalImprove) return { run: false, reason: 'skipped' };
  if (!evalResult || evalResult.skipped) return { run: false, reason: 'no_eval' };
  if (evalResult.ok === false) return { run: true, reason: 'gate_fail' };
  const misses = countEvalMisses(evalResult);
  const rate = Number(evalResult.rate) || 0;
  const polishMissMin = opts.polishMissMin ?? EVAL_IMPROVE_POLISH_MISS_MIN;
  const polishPassA = opts.polishPassA ?? EVAL_IMPROVE_POLISH_PASS_A;
  if (misses >= polishMissMin || rate < polishPassA) {
    return { run: true, reason: 'polish' };
  }
  return { run: false, reason: 'healthy' };
}

/**
 * Optionally run one improve round; returns post-improve evalResult (or original).
 */
export async function maybeRunEvalImprove(opts) {
  const log = opts.log || (() => {});
  const decision = shouldRunEvalImprove(opts.evalResult, opts);
  if (!decision.run) {
    return {
      ran: false,
      reason: decision.reason,
      evalResult: opts.evalResult,
      improve: null,
    };
  }
  log(`eval-improve start phase=${opts.phase || '?'} reason=${decision.reason}`);
  const improve = await runImproveRound(opts);
  log(
    `eval-improve done accepted=${!!improve.accepted} reason=${improve.reason || ''}`,
  );
  return {
    ran: improve.ran,
    reason: decision.reason,
    evalResult: improve.evalResult || opts.evalResult,
    improve,
  };
}
