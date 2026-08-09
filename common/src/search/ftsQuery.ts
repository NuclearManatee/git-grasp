// @ts-nocheck
/**
 * FTS5 query helpers (pure â€” safe for Vitest).
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
 * Build FTS5 MATCH expression: token AND token â€¦
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

/**
 * FTS body for a v9 recipe: commands + comments + title + tags + description + paraphrases.
 * Paraphrases are not embedded (KNN stays description-only) but must be searchable via BM25
 * so triage bucket-1 aliases affect retrieval.
 */
export function recipeFtsBody(
  steps: Iterable<{ command?: string; comment?: string }>,
  meta: {
    title?: string;
    description?: string;
    tags?: Iterable<string>;
    paraphrases?: Iterable<string>;
  } = {},
): string {
  const parts: string[] = [];
  if (meta.title) parts.push(String(meta.title));
  if (meta.description) parts.push(String(meta.description));
  if (meta.tags) {
    for (const t of meta.tags) {
      if (t) parts.push(String(t));
    }
  }
  if (meta.paraphrases) {
    for (const p of meta.paraphrases) {
      if (p) parts.push(String(p));
    }
  }
  for (const s of steps) {
    if (s.command) parts.push(String(s.command));
    if (s.comment) parts.push(String(s.comment));
  }
  return parts.join('\n');
}
