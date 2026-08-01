/**
 * FTS5 query helpers (pure — safe for Vitest).
 */

/** Tokenize for FTS AND query; strip FTS specials. */
export function tokenizeForFts(query: string): string[] {
  return String(query || '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/["*^\-():{}[\]~]/g, ''))
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/**
 * Build FTS5 MATCH expression: token AND token …
 * Returns null if no usable tokens.
 */
export function buildFtsMatchQuery(query: string): string | null {
  const tokens = tokenizeForFts(query);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '')}"`).join(' AND ');
}

/** Body text for one command FTS row (argv + comments + linked intents). */
export function commandFtsBody(
  steps: Iterable<{ command?: string; comment?: string }>,
  intentTexts: Iterable<string> = [],
): string {
  const parts: string[] = [];
  for (const s of steps) {
    if (s.command) parts.push(String(s.command));
    if (s.comment) parts.push(String(s.comment));
  }
  for (const t of intentTexts) {
    if (t) parts.push(String(t));
  }
  return parts.join('\n');
}
