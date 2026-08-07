// @ts-nocheck
/**
 * Post-floor iteration budget helpers for the catalog build loop.
 *
 * Eval KO is advisory until bank floors are met; once floors pass, an optional
 * `--post-floor-iterations=N` budget allows N more full iterations before stop
 * (independent of --max-iterations, which remains a hard overall cap).
 */

/**
 * Sticky first iteration at which bank floors pass.
 * @param {number|null|undefined} floorMetAtIter
 * @param {boolean} floorsOk
 * @param {number} iteration
 * @returns {number|null}
 */
export function recordFloorMetAtIter(floorMetAtIter, floorsOk, iteration) {
  if (floorMetAtIter != null) return floorMetAtIter;
  return floorsOk ? iteration : null;
}

/**
 * Whether the loop should stop because the post-floor budget is exhausted.
 * Stops after `floorMetAtIter + postFloorIterations` (N more full iters after
 * the floor-met one). Disabled when `postFloorIterations` is null/undefined.
 *
 * @param {{
 *   iteration: number,
 *   floorMetAtIter: number|null|undefined,
 *   postFloorIterations: number|null|undefined,
 * }} args
 * @returns {{ stop: boolean, floorMetAtIter?: number, ranMore?: number }}
 */
export function shouldStopAfterPostFloorBudget({
  iteration,
  floorMetAtIter,
  postFloorIterations,
}) {
  if (postFloorIterations == null) return { stop: false };
  if (floorMetAtIter == null) return { stop: false };
  const n = Math.max(0, Math.floor(Number(postFloorIterations)));
  if (!Number.isFinite(n)) return { stop: false };
  if (iteration >= floorMetAtIter + n) {
    return {
      stop: true,
      floorMetAtIter,
      ranMore: iteration - floorMetAtIter,
    };
  }
  return { stop: false };
}
