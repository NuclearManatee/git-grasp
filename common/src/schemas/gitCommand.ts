// @ts-nocheck
import { z } from 'zod';
import { SKILL_MAX, SKILL_MIN } from '../lib/skills.js';

export const SHELL_META = /(&&|\|\||[|;`]|\$\(|\$\{|\n|\r)/;

export const ALLOWED_SUBCOMMANDS = new Set([
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

export type ValidateOpts = {
  extraAllowlist?: Iterable<string>;
};

export type ValidateResult =
  | { ok: true }
  | { ok: false; reason: string; run?: string };

export function checkCommand(command: unknown, opts: ValidateOpts = {}): ValidateResult {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, reason: 'schema' };
  }
  const c = command.trim();
  if (c.length > 512) return { ok: false, reason: 'length' };
  if (SHELL_META.test(c)) return { ok: false, reason: 'shell_meta' };
  if (!/^git(\s|$)/.test(c)) return { ok: false, reason: 'allowlist' };
  const parts = c.split(/\s+/);
  if (parts.length === 1) return { ok: true };
  const sub = parts[1]!;
  if (sub.startsWith('-')) return { ok: true };
  const extra = opts.extraAllowlist ? new Set(opts.extraAllowlist) : null;
  if (!ALLOWED_SUBCOMMANDS.has(sub) && !(extra && extra.has(sub))) {
    return { ok: false, reason: 'allowlist' };
  }
  return { ok: true };
}

export function checkExample(example: unknown, opts: ValidateOpts = {}): ValidateResult {
  const base = checkCommand(example, opts);
  if (!base.ok) return base;
  const e = String(example)
    .trim()
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
  if (/<[^>]+>/.test(e)) return { ok: false, reason: 'placeholder' };
  const tokens = e.split(/\s+/);
  if (tokens.length > 14) return { ok: false, reason: 'prose' };
  if (/\b(fetches|will NOT|by default|equivalent to|note:|use add to)\b/i.test(e)) {
    return { ok: false, reason: 'prose' };
  }
  if (/#/.test(e)) return { ok: false, reason: 'inline_comment' };
  return { ok: true };
}

/** Accepts v6 TEXT enums or legacy numeric 1â€“4 (coerced to number for old paths). */
export const SkillLevelSchema = z.union([
  z.number().int().min(SKILL_MIN).max(SKILL_MAX),
  z.enum(['nontechnical', 'non-technical', 'beginner', 'intermediate', 'expert']),
]);

export function gitCommandSchema(opts: ValidateOpts = {}) {
  return z.string().superRefine((val, ctx) => {
    const r = checkCommand(val, opts);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.reason });
    }
  });
}

export function gitExampleSchema(opts: ValidateOpts = {}) {
  return z.string().superRefine((val, ctx) => {
    const r = checkExample(val, opts);
    if (!r.ok) {
      ctx.addIssue({ code: 'custom', message: r.reason });
    }
  });
}
