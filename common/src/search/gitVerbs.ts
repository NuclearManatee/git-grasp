// @ts-nocheck
/**
 * git_verbs meta helpers (seed-generated allowlist for query profiling).
 */

export function serializeGitVerbsMeta(verbs: readonly string[]): string {
  return JSON.stringify([...verbs]);
}

export function parseGitVerbsMeta(raw: unknown): string[] {
  if (raw == null) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Extract distinct git verbs from recipe command strings.
 * e.g. "git reset --soft HEAD~1" â†’ "reset"
 */
export function extractVerbFromCommand(command: string): string | null {
  const parts = String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return null;
  let i = 0;
  if (parts[0] === 'git') i = 1;
  const verb = parts[i];
  if (!verb || verb.startsWith('-')) return null;
  return verb.toLowerCase();
}

export function collectGitVerbsFromRecipes(
  recipes: Iterable<{ commands?: { command?: string }[] } | string>,
): string[] {
  const set = new Set<string>();
  for (const r of recipes) {
    if (typeof r === 'string') {
      const v = extractVerbFromCommand(r);
      if (v) set.add(v);
      continue;
    }
    const cmds = r.commands ?? [];
    for (const step of cmds) {
      const v = extractVerbFromCommand(step.command ?? '');
      if (v) set.add(v);
    }
  }
  return [...set].sort();
}
