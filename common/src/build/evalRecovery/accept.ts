// @ts-nocheck
/**
 * Accept / early-stop helpers for eval gate recovery.
 */

export function metricsSlice(evalResult) {
  return {
    ok: !!evalResult?.ok,
    okHit: !!evalResult?.okHit,
    okPass: !!evalResult?.okPass,
    passed: Number(evalResult?.passed) || 0,
    hitPassed: Number(evalResult?.hitPassed) || 0,
    total: Number(evalResult?.total) || 0,
    rate: Number(evalResult?.rate) || 0,
    hitRate: Number(evalResult?.hitRate) || 0,
  };
}

export function metricsForCommandIds(evalResult, commandIds) {
  const set = commandIds instanceof Set ? commandIds : new Set(commandIds || []);
  const results = (evalResult?.results || []).filter((r) =>
    set.has(Number(r?.query?.command_id)),
  );
  const total = results.length;
  if (!total) {
    return { total: 0, hitPassed: 0, passed: 0, hitRate: 1, rate: 1 };
  }
  const hitPassed = results.filter((r) => r.via === 'hit@display').length;
  const passed = results.filter((r) => r.pass).length;
  return {
    total,
    hitPassed,
    passed,
    hitRate: hitPassed / total,
    rate: passed / total,
  };
}

export function isFlatMetrics(before, after) {
  return (
    (after.passed || 0) === (before.passed || 0) &&
    (after.hitPassed || 0) === (before.hitPassed || 0)
  );
}

/**
 * @param {{
 *   mode: 'fail'|'polish',
 *   before: object,
 *   after: object,
 *   holdoutBefore: object,
 *   holdoutAfter: object,
 *   bankBeforeLen: number,
 *   bankAfterLen: number,
 *   bankFloor: number,
 *   commandsUnchanged?: boolean,
 *   additiveOnly?: boolean,
 * }} args
 */
export function shouldAcceptRecoveryAttempt(args) {
  const {
    mode,
    before,
    after,
    holdoutBefore,
    holdoutAfter,
    bankBeforeLen,
    bankAfterLen,
    bankFloor,
    commandsUnchanged = true,
    additiveOnly = false,
  } = args;

  // Non-additive catalog mutations are forbidden. Additive inserts
  // (coverage_gap composites) set commandsUnchanged=false + additiveOnly=true.
  if (!commandsUnchanged && !additiveOnly) {
    return { ok: false, reason: 'commands_changed' };
  }
  if (bankAfterLen + 1e-9 < bankBeforeLen * bankFloor) {
    return { ok: false, reason: 'bank_size_floor' };
  }
  if (holdoutBefore?.total > 0) {
    if (holdoutAfter.hitRate + 1e-9 < holdoutBefore.hitRate) {
      return { ok: false, reason: 'holdout_hit_drop' };
    }
    if (holdoutAfter.rate + 1e-9 < holdoutBefore.rate) {
      return { ok: false, reason: 'holdout_pass_drop' };
    }
  }
  if ((after.hitPassed || 0) + 1e-9 < (before.hitPassed || 0)) {
    return { ok: false, reason: 'hit_display_drop' };
  }

  const passDelta = (after.passed || 0) - (before.passed || 0);

  if (mode === 'polish') {
    if (!after.ok) return { ok: false, reason: 'polish_lost_gate' };
    if (passDelta >= 1) return { ok: true, reason: 'pass_up' };
    if (passDelta === 0 && (after.hitPassed || 0) > (before.hitPassed || 0)) {
      return { ok: true, reason: 'hit_up_tie' };
    }
    return { ok: false, reason: 'no_polish_gain' };
  }

  // fail-retry
  if (after.ok) return { ok: true, reason: 'gate_green' };
  if (passDelta >= 1) return { ok: true, reason: 'pass_up_toward_green' };
  if (passDelta === 0 && (after.hitPassed || 0) > (before.hitPassed || 0)) {
    return { ok: true, reason: 'hit_up_toward_green' };
  }
  return { ok: false, reason: 'no_fail_gain' };
}
