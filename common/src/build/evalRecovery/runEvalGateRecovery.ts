// @ts-nocheck
/**
 * Eval gate recovery: fail-retry (bank + improve + coverage) and polish-after-pass.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  EVAL_GATE_FAIL_RETRY_MAX,
  EVAL_GATE_POLISH_RETRY_MAX,
  EVAL_IMPROVE_POLISH_MISS_MIN,
  EVAL_IMPROVE_POLISH_PASS_A,
  EVAL_GATE_FAIL_BANK_SIZE_FLOOR,
  EVAL_GATE_POLISH_BANK_SIZE_FLOOR,
} from '../../db/constants.js';
import { openDb, listCommands } from '../../db/schema.js';
import { evalGateRecoveryDir } from '../../lib/paths.js';
import { activeEvaluationBank } from '../evalGate.js';
import { countEvalMisses, collectEvalMisses } from '../evalImprove/collectMisses.js';
import { runImproveRound } from '../evalImprove/runImproveRound.js';
import { splitTrainHoldoutByCommandId } from '../evalImprove/splitHoldout.js';
import { buildVerbFamilyIndex } from '../evalImprove/verbFamilies.js';
import {
  classifyEvalMisses,
  partitionByClass,
  needsBankRewrite,
  needsImproveRound,
  needsCoverageGeneration,
} from './classifyMisses.js';
import { buildRecipeVerbCoverage } from './coverageHelpers.js';
import {
  generateCoverageGapComposites,
  rollbackCoverageInserts,
} from './generateCoverage.js';
import {
  snapshotGoldenBank,
  restoreGoldenBank,
  applyGoldenActions,
} from './bankHelpers.js';
import {
  metricsSlice,
  metricsForCommandIds,
  isFlatMetrics,
  shouldAcceptRecoveryAttempt,
} from './accept.js';
import { proposeRewriteContext, proposeGoldenRewrites } from './rewriteGoldens.js';

function writeJson(dir, name, value) {
  writeFileSync(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function polishWarranted(evalResult, opts = {}) {
  const misses = countEvalMisses(evalResult);
  const rate = Number(evalResult?.rate) || 0;
  const polishMissMin = opts.polishMissMin ?? EVAL_IMPROVE_POLISH_MISS_MIN;
  const polishPassA = opts.polishPassA ?? EVAL_IMPROVE_POLISH_PASS_A;
  return misses >= polishMissMin || rate < polishPassA;
}

function reloadGoldenBank(opts) {
  if (typeof opts.reloadBank === 'function') return opts.reloadBank();
  return activeEvaluationBank({ kinds: ['golden'], excludeFallbacks: true });
}

function loadRecipeCoverage(opts) {
  if (Array.isArray(opts.recipeVerbCoverage)) return opts.recipeVerbCoverage;
  try {
    const ownsDb = !opts.db;
    const db = opts.db || openDb(opts.stagingPath);
    try {
      return buildRecipeVerbCoverage(listCommands(db));
    } finally {
      if (ownsDb) db.close();
    }
  } catch {
    return [];
  }
}

/**
 * @param {object} opts
 */
export async function runEvalGateRecovery(opts) {
  const log = opts.log || (() => {});
  if (opts.skipEvalRecovery) {
    return {
      ran: false,
      reason: 'skipped',
      evalResult: opts.evalResult,
      attempts: [],
    };
  }

  let evalResult = opts.evalResult;
  if (!evalResult || evalResult.skipped) {
    return { ran: false, reason: 'no_eval', evalResult, attempts: [] };
  }

  const failMax = opts.evalFailRetryMax ?? EVAL_GATE_FAIL_RETRY_MAX;
  const polishMax = opts.evalPolishRetryMax ?? EVAL_GATE_POLISH_RETRY_MAX;
  const familyIndex = opts.familyIndex || buildVerbFamilyIndex();

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const artRoot = opts.artifactsDir || path.join(evalGateRecoveryDir(), ts);
  mkdirSync(artRoot, { recursive: true });

  const cycleStartBank = snapshotGoldenBank();
  let bestAccepted = null;
  /** @type {object[]} */
  const attempts = [];
  const startedOk = !!evalResult.ok;

  const runMode = async (mode, maxAttempts) => {
    let used = 0;
    while (used < maxAttempts) {
      if (mode === 'fail' && evalResult.ok) break;
      if (mode === 'polish') {
        if (!evalResult.ok) break;
        if (!polishWarranted(evalResult, opts)) break;
      }

      used += 1;
      const attemptDir = path.join(artRoot, `${mode}-${used}`);
      mkdirSync(attemptDir, { recursive: true });
      const before = metricsSlice(evalResult);
      const bankSnap = snapshotGoldenBank();
      const recipeVerbCoverage = loadRecipeCoverage(opts);
      const classified = classifyEvalMisses(evalResult.results || [], {
        familyIndex,
        recipeVerbCoverage,
      });
      writeJson(
        attemptDir,
        'classification.json',
        classified.map((c) => ({
          class: c.class,
          command_id: c.command_id,
          query_text: c.query_text,
          primary_verb: c.primary_verb,
        })),
      );

      const parts = partitionByClass(classified);
      const bankMisses = [
        ...parts.partial_multistep,
        ...parts.over_ask,
        ...parts.destructive_alt,
      ];
      const doBank = needsBankRewrite(classified) && bankMisses.length > 0;
      const doImprove =
        needsImproveRound(classified) && opts.skipEvalImprove !== true;
      const doCoverage =
        needsCoverageGeneration(classified) &&
        parts.coverage_gap.length > 0 &&
        opts.embedder;

      if (!doBank && !doImprove && !doCoverage) {
        log(`recovery ${mode}#${used} no actionable classes — stop`);
        attempts.push({ mode, used, reason: 'no_actions', accepted: false });
        writeJson(attemptDir, 'decision.json', { accepted: false, reason: 'no_actions' });
        break;
      }

      const missesForSplit = collectEvalMisses(evalResult);
      const { holdoutIds } = splitTrainHoldoutByCommandId(missesForSplit);
      const holdoutBefore = metricsForCommandIds(evalResult, holdoutIds);

      let mutated = false;
      /** @type {number[]} */
      let coverageInsertedIds = [];
      let additiveOnly = false;

      if (doBank) {
        try {
          const context = await proposeRewriteContext(bankMisses, {
            llmJsonObject: opts.llmJsonObject,
            proModel: opts.proModel,
          });
          writeJson(attemptDir, 'rewrite-context.json', context);
          const { actions, errors } = await proposeGoldenRewrites(bankMisses, context, {
            llmJsonObject: opts.llmJsonObject,
            flashModel: opts.flashModel,
            mode,
          });
          writeJson(attemptDir, 'rewrite-actions.json', { actions, errors });
          if (actions.length) {
            const applied = applyGoldenActions(actions, { mode, allowDrop: true });
            writeJson(attemptDir, 'bank-apply.json', {
              ok: applied.ok,
              reason: applied.reason,
              dropped: applied.dropped,
              rewritten: applied.rewritten,
              beforeLen: applied.before.length,
              afterLen: applied.after.length,
            });
            if (applied.ok) mutated = true;
            else restoreGoldenBank(bankSnap);
          }
        } catch (e) {
          log(`recovery ${mode}#${used} rewrite failed: ${e?.message || e}`);
          restoreGoldenBank(bankSnap);
          writeJson(attemptDir, 'rewrite-error.json', { error: String(e?.message || e) });
        }
      }

      if (doCoverage) {
        try {
          const gen = await generateCoverageGapComposites(parts.coverage_gap, {
            stagingPath: opts.stagingPath,
            db: opts.db,
            embedder: opts.embedder,
            llmJsonObject: opts.llmJsonObject,
            expandIntents: opts.expandIntents,
            validate: opts.validate,
            log,
          });
          writeJson(attemptDir, 'coverage-gen.json', gen);
          if (gen.insertedIds.length) {
            coverageInsertedIds = gen.insertedIds;
            mutated = true;
            additiveOnly = true;
          }
        } catch (e) {
          log(`recovery ${mode}#${used} coverage_gap failed: ${e?.message || e}`);
          writeJson(attemptDir, 'coverage-error.json', {
            error: String(e?.message || e),
          });
        }
      }

      let afterEval = evalResult;

      if (mutated) {
        const freshBank = reloadGoldenBank(opts);
        log(`recovery ${mode}#${used} re-eval after bank/coverage bank=${freshBank.length}`);
        afterEval = await opts.runBankEval(freshBank, opts.stagingPath, {
          llmJsonObject: opts.llmJsonObject,
          verbLookup: opts.verbLookup,
          minPassRate: opts.minPassRate,
          minHitAtDisplayRate: opts.minHitAtDisplayRate,
          searchFn: opts.searchFn,
          evalConcurrency: opts.evalConcurrency,
        });
      }

      if (doImprove) {
        const improveResult = await runImproveRound({
          evalResult: afterEval,
          stagingPath: opts.stagingPath,
          db: opts.db,
          embedder: opts.embedder,
          bank: reloadGoldenBank(opts),
          runBankEval: opts.runBankEval,
          taxonomyVerbs: opts.taxonomyVerbs,
          verbLookup: opts.verbLookup,
          llmJsonObject: opts.llmJsonObject,
          trapsPath: opts.trapsPath,
          familiesPath: opts.familiesPath,
          expandIntents: opts.expandIntents,
          minPassRate: opts.minPassRate,
          minHitAtDisplayRate: opts.minHitAtDisplayRate,
          searchFn: opts.searchFn,
          evalConcurrency: opts.evalConcurrency,
          artifactsDir: path.join(attemptDir, 'improve'),
          log,
        });
        writeJson(attemptDir, 'improve-summary.json', {
          ran: improveResult?.ran,
          accepted: improveResult?.accepted,
          reason: improveResult?.reason,
        });
        if (improveResult?.accepted && improveResult.evalResult) {
          afterEval = improveResult.evalResult;
          mutated = true;
        }
      }

      if (!mutated) {
        attempts.push({ mode, used, accepted: false, reason: 'noop' });
        writeJson(attemptDir, 'decision.json', { accepted: false, reason: 'noop' });
        break;
      }

      const holdoutAfter = metricsForCommandIds(afterEval, holdoutIds);
      const bankAfter = snapshotGoldenBank();
      const floor =
        mode === 'polish'
          ? EVAL_GATE_POLISH_BANK_SIZE_FLOOR
          : EVAL_GATE_FAIL_BANK_SIZE_FLOOR;
      const floorBase = mode === 'fail' ? cycleStartBank.length : bankSnap.length;
      const decision = shouldAcceptRecoveryAttempt({
        mode,
        before,
        after: metricsSlice(afterEval),
        holdoutBefore,
        holdoutAfter,
        bankBeforeLen: floorBase,
        bankAfterLen: bankAfter.length,
        bankFloor: floor,
        commandsUnchanged: coverageInsertedIds.length === 0,
        additiveOnly,
      });

      writeJson(attemptDir, 'metrics-before.json', { full: before, holdout: holdoutBefore });
      writeJson(attemptDir, 'metrics-after.json', {
        full: metricsSlice(afterEval),
        holdout: holdoutAfter,
      });
      writeJson(attemptDir, 'decision.json', {
        accepted: decision.ok,
        reason: decision.reason,
        coverageInsertedIds,
      });

      if (decision.ok) {
        evalResult = afterEval;
        bestAccepted = { evalResult, bank: snapshotGoldenBank() };
        attempts.push({ mode, used, accepted: true, reason: decision.reason });
        log(`recovery ${mode}#${used} ACCEPT (${decision.reason})`);
        if (isFlatMetrics(before, metricsSlice(evalResult))) break;
        continue;
      }

      restoreGoldenBank(bankSnap);
      if (coverageInsertedIds.length) {
        rollbackCoverageInserts(opts.stagingPath, coverageInsertedIds, opts.db);
      }
      attempts.push({ mode, used, accepted: false, reason: decision.reason });
      log(`recovery ${mode}#${used} REJECT (${decision.reason})`);
      if (isFlatMetrics(before, metricsSlice(afterEval))) break;
    }
  };

  if (!evalResult.ok && failMax > 0) {
    log(`recovery fail-retry start max=${failMax}`);
    await runMode('fail', failMax);
  }
  if (evalResult.ok && polishWarranted(evalResult, opts) && polishMax > 0) {
    log(`recovery polish start max=${polishMax}`);
    await runMode('polish', polishMax);
  }

  if (bestAccepted && !startedOk) {
    restoreGoldenBank(bestAccepted.bank);
    evalResult = bestAccepted.evalResult;
  }

  writeJson(artRoot, 'summary.json', {
    phase: opts.phase || null,
    attempts,
    final: metricsSlice(evalResult),
  });

  return {
    ran: attempts.length > 0,
    reason: startedOk ? 'polish_or_healthy' : 'fail_retry',
    evalResult,
    attempts,
    artifactsDir: artRoot,
  };
}
