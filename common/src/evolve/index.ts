// @ts-nocheck
/**
 * EVOLVE — planned: judge OBSERVE queries → feed EXPAND for a new corpus version.
 *
 * Not implemented yet. This module is a stable import surface for the future loop.
 * Design intent:
 *   1. Collect opted-in search queries (and outcomes) from OBSERVE
 *   2. Judge / cluster misses (reuse EXPAND triage buckets 1/2/3)
 *   3. Apply EXPAND actions → regression → SHIP new recipes.vN
 */
export const EVOLVE_STATUS = 'planned';

export function evolveFromObservedQueries() {
  throw new Error(
    'EVOLVE is not implemented yet — use EXPAND (held-out/triage) until observe→judge ships',
  );
}
