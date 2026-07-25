const SHELL_META = /(&&|\|\||[|;`]|\$\(|\$\{|\n|\r)/;

const ALLOWED_SUBCOMMANDS = new Set([
  'add', 'am', 'annotate', 'apply', 'archive', 'bisect', 'blame', 'branch', 'bugreport',
  'bundle', 'checkout', 'cherry', 'cherry-pick', 'citool', 'clean', 'clone', 'commit',
  'config', 'count-objects', 'credential', 'describe', 'diff', 'difftool', 'fast-export',
  'fast-import', 'fetch', 'filter-branch', 'format-patch', 'fsck', 'gc', 'grep', 'gui',
  'help', 'init', 'instaweb', 'log', 'maintenance', 'merge', 'mergetool', 'mv', 'notes',
  'pull', 'push', 'range-diff', 'rebase', 'reflog', 'remote', 'repack', 'replace',
  'request-pull', 'reset', 'restore', 'revert', 'rm', 'shortlog', 'show', 'show-branch',
  'sparse-checkout', 'stash', 'status', 'submodule', 'switch', 'tag', 'verify-commit',
  'verify-tag', 'version', 'whatchanged', 'worktree', 'refs', 'rev-parse', 'rev-list',
  'ls-files', 'ls-remote', 'update-index', 'update-ref', 'symbolic-ref', 'check-ignore',
  'check-attr', 'name-rev', 'merge-base', 'for-each-ref', 'interpret-trailers',
  'stage', 'prune',
]);

export function commandSlug(command) {
  return String(command)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function makeRowId(command, skillLevel) {
  return `${commandSlug(command)}:${skillLevel}`;
}

/**
 * Validate a git command string for catalog insertion.
 * @param {string} command
 * @param {{ extraAllowlist?: Iterable<string> }} [opts]
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateCommand(command, opts = {}) {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, reason: 'schema' };
  }
  const c = command.trim();
  if (c.length > 512) return { ok: false, reason: 'length' };
  if (SHELL_META.test(c)) return { ok: false, reason: 'shell_meta' };
  if (!/^git(\s|$)/.test(c)) return { ok: false, reason: 'allowlist' };
  const parts = c.split(/\s+/);
  if (parts.length === 1) return { ok: true }; // bare `git`
  const sub = parts[1];
  if (sub.startsWith('-')) return { ok: true }; // git --version etc.
  const extra = opts.extraAllowlist ? new Set(opts.extraAllowlist) : null;
  if (!ALLOWED_SUBCOMMANDS.has(sub) && !(extra && extra.has(sub))) {
    return { ok: false, reason: 'allowlist' };
  }
  return { ok: true };
}

export function validateIntentRow(row, opts = {}) {
  const base = validateCommand(row.command, opts);
  if (!base.ok) return base;
  if (!row.intent_description || typeof row.intent_description !== 'string') {
    return { ok: false, reason: 'schema' };
  }
  if (row.intent_description.length > 2000) return { ok: false, reason: 'length' };
  const level = Number(row.skill_level);
  if (!Number.isInteger(level) || level < 1 || level > 5) {
    return { ok: false, reason: 'schema' };
  }
  return { ok: true };
}
