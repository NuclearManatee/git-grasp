// @ts-nocheck
/**
 * Collect non-pass eval rows for the improve round.
 */

/**
 * @param {{ results?: object[], total?: number, passed?: number, rate?: number }} evalResult
 */
export function collectEvalMisses(evalResult) {
  const results = evalResult?.results || [];
  return results.filter((r) => r && r.pass !== true && r.via !== 'skipped');
}

/**
 * Miss count for polish policy (includes empty display / wrong / judge KO).
 * Skipped Phase-1 abort rows count as misses too when gate failed hard.
 */
export function countEvalMisses(evalResult) {
  const results = evalResult?.results || [];
  if (!results.length) {
    const total = Number(evalResult?.total) || 0;
    const passed = Number(evalResult?.passed) || 0;
    return Math.max(0, total - passed);
  }
  return results.filter((r) => !r || r.pass !== true).length;
}
