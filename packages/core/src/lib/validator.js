import { isValidSkillLevel, SKILL_MAX, SKILL_MIN } from './skills.js';

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

/**
 * E4: normalize example for dedup — trim, collapse whitespace, unify quotes.
 * @param {string} example
 */
export function normalizeExample(example) {
  return String(example || '')
    .trim()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ');
}

export function commandSlug(command) {
  return String(command)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Row id: slug(example):skill:intentIndex
 * @param {string} example
 * @param {number} skillLevel
 * @param {number} [intentIndex=0]
 */
export function makeRowId(example, skillLevel, intentIndex = 0) {
  return `${commandSlug(example)}:${skillLevel}:${intentIndex}`;
}

/**
 * Validate a git command or example string for catalog insertion.
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

/**
 * Examples must be pasteable: no angle-bracket placeholders.
 * @param {string} example
 */
export function validateExample(example, opts = {}) {
  const base = validateCommand(example, opts);
  if (!base.ok) return base;
  const e = normalizeExample(example);
  if (/<[^>]+>/.test(e)) return { ok: false, reason: 'placeholder' };
  return { ok: true };
}

export function validateIntentRow(row, opts = {}) {
  const cmd = validateCommand(row.command, opts);
  if (!cmd.ok) return cmd;
  const example = row.example != null ? row.example : row.command;
  const ex = validateExample(example, opts);
  if (!ex.ok) return ex;
  if (!row.intent_description || typeof row.intent_description !== 'string') {
    return { ok: false, reason: 'schema' };
  }
  if (row.intent_description.length > 2000) return { ok: false, reason: 'length' };
  if (!isValidSkillLevel(row.skill_level)) {
    return { ok: false, reason: 'schema' };
  }
  return { ok: true };
}

export { SKILL_MIN, SKILL_MAX, ALLOWED_SUBCOMMANDS };
