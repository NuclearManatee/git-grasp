/**
 * Pure recipe command helpers (no bun:sqlite) — safe for Vitest.
 */

/**
 * @param {unknown} commands
 * @returns {string}
 */
export function serializeCommands(commands) {
  if (typeof commands === 'string') return commands;
  return JSON.stringify(commands ?? []);
}

/**
 * @param {string | unknown} raw
 * @returns {Array<{ run: string, comment?: string }>}
 */
export function parseCommands(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw == null || raw === '') return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => ({
      run: String(c?.run ?? '').trim(),
      comment: String(c?.comment ?? '').trim(),
    })).filter((c) => c.run);
  } catch {
    return [];
  }
}

/**
 * Render giteveryday-style snippet with inline comments.
 * @param {Array<{ run: string, comment?: string }> | string} commands
 */
export function renderSnippet(commands) {
  const steps = parseCommands(commands);
  return steps.map((s) => {
    const comment = s.comment ? `  # ${s.comment}` : '';
    return `${s.run}${comment}`;
  }).join('\n');
}
