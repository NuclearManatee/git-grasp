// @ts-nocheck
/**
 * Outcome labels from search response fields (code-first).
 */

/**
 * @param {object} response
 * @returns {'satisfied'|'weak'|'miss'}
 */
export function labelFromResponse(response = {}) {
  const status = String(response.status || '');
  const confidence =
    typeof response.confidence === 'number' ? response.confidence : null;
  const displayCount =
    typeof response.displayCount === 'number'
      ? response.displayCount
      : Array.isArray(response.results)
        ? response.results.length
        : 0;

  if (status === 'error') return 'miss';
  if (status === 'empty' || displayCount === 0) return 'miss';
  if (confidence == null) {
    return displayCount === 1 ? 'satisfied' : 'weak';
  }
  if (confidence > 0.75 && displayCount >= 1) return 'satisfied';
  if (confidence >= 0.4) return 'weak';
  return 'miss';
}

/**
 * Ambiguous for optional LLM confirm.
 * @param {'satisfied'|'weak'|'miss'|'abandon'} label
 */
export function isAmbiguousLabel(label) {
  return label === 'weak' || label === 'abandon';
}
