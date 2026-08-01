// @ts-nocheck
/**
 * Optional phase timings when GIT_GRASP_BENCH=1.
 * Accumulates wall ms per phase for the current search call.
 */

/** @type {null | Record<string, number>} */
let current = null;

export function benchEnabled() {
  return process.env.GIT_GRASP_BENCH === '1';
}

export function benchBegin() {
  if (!benchEnabled()) {
    current = null;
    return;
  }
  current = Object.create(null);
}

/** @param {string} phase */
export function benchMark(phase) {
  if (!current) return;
  const now = performance.now();
  current._t0 ??= now;
  current._last ??= now;
  const elapsed = now - current._last;
  current[phase] = (current[phase] || 0) + elapsed;
  current._last = now;
}

export function benchEnd() {
  if (!current) return null;
  const { _t0, _last, ...phases } = current;
  const total = _t0 != null ? performance.now() - _t0 : 0;
  current = null;
  return { total, phases };
}

/** Last completed breakdown (for CLI stderr). */
let lastBreakdown = null;

export function benchStoreLast(breakdown) {
  lastBreakdown = breakdown;
}

export function benchTakeLast() {
  const v = lastBreakdown;
  lastBreakdown = null;
  return v;
}
