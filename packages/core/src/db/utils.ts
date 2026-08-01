// @ts-nocheck
/**
 * Pure helpers shared by catalog normalize and DB layer (no bun:sqlite).
 */

/**
 * Normalize usage to "command_line\\nblurb" form.
 * @param {string | { command_line?: string, blurb?: string } | null | undefined} usage
 * @param {string} [fallbackExample]
 */
export function normalizeUsage(usage, fallbackExample = '') {
  if (usage && typeof usage === 'object') {
    const line = String(usage.command_line || fallbackExample || '').trim();
    const blurb = String(usage.blurb || '').trim();
    return blurb ? `${line}\n${blurb}` : line;
  }
  const s = String(usage || '').trim();
  if (s) return s;
  return String(fallbackExample || '').trim();
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Cosine distance from sqlite-vec ÔåÆ similarity in [0, 1].
 */
export function distanceToSimilarity(distance) {
  const d = Number(distance);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(1, 1 - d));
}
