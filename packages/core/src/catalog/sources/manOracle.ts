// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { docsDir, loadLocalDocs } from '../downloadDocs.js';
import { PACKAGE_ROOT } from '../../lib/paths.js';
import { spawnGit } from '../../build/gitExec.js';
import { manOracleCachePath, sourcesCacheDir } from './pins.js';

/**
 * Extract long/short option tokens from man-style text.
 * @param {string} text
 * @returns {Set<string>}
 */
export function parseFlagsFromManText(text) {
  const flags = new Set();
  const src = String(text || '');
  // Long options: --foo, --foo-bar, --foo=VAL
  for (const m of src.matchAll(/--[a-z0-9][a-z0-9-]*/gi)) {
    flags.add(m[0].toLowerCase());
  }
  // Short clusters in option lists: -a, -abc (treat each letter when preceded by space/start)
  for (const m of src.matchAll(/(?:^|[\s,\[(])-([a-zA-Z])(?![a-zA-Z0-9-])/gm)) {
    flags.add(`-${m[1]}`);
  }
  // Explicit -u style in SYNOPSIS lines
  for (const m of src.matchAll(/\s(-[a-zA-Z])(?:\s|,|=|\]|$)/g)) {
    flags.add(m[1]);
  }
  return flags;
}

/**
 * @param {string} run  e.g. "git reset --soft HEAD~1"
 * @returns {{ subcommand: string | null, flags: string[] }}
 */
export function extractFlagsFromRun(run) {
  const parts = String(run || '').trim().split(/\s+/);
  if (parts[0] !== 'git') return { subcommand: null, flags: [] };
  let sub = null;
  let i = 1;
  if (parts[1] && !parts[1].startsWith('-')) {
    sub = parts[1];
    i = 2;
  }
  const flags = [];
  for (; i < parts.length; i += 1) {
    const p = parts[i];
    if (p === '--') break;
    if (p.startsWith('--')) {
      flags.push(p.split('=')[0].toLowerCase());
    } else if (/^-[a-zA-Z]/.test(p) && p !== '-') {
      // -abc ÔåÆ -a -b -c; -am stays as cluster for allow check of each letter
      const body = p.slice(1);
      if (body.startsWith('-')) continue;
      for (const ch of body) {
        if (/[a-zA-Z]/.test(ch)) flags.push(`-${ch}`);
      }
    }
  }
  return { subcommand: sub, flags };
}

/**
 * Short help text for a subcommand (`git <cmd> -h`).
 * Never call `git help <cmd>` — on Windows that opens the HTML help viewer.
 * @param {string} subcommand
 * @returns {string}
 */
export function gitHelpText(subcommand) {
  try {
    const r = spawnGit([subcommand, '-h'], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 15_000,
    });
    return `${r.stdout || ''}${r.stderr || ''}`.trim();
  } catch {
    return '';
  }
}

/**
 * Build flag allow-sets keyed by subcommand from local docs + optional git help.
 * @param {{ root?: string, useGitHelp?: boolean, docs?: object[] }} [opts]
 */
export function buildManOracle({
  root = PACKAGE_ROOT,
  useGitHelp = true,
  docs = null,
} = {}) {
  const pages = docs || (existsSync(docsDir(root)) ? loadLocalDocs(root, { maxChars: 500_000 }) : []);
  /** @type {Map<string, Set<string>>} */
  const bySub = new Map();

  function addFlags(sub, flagSet) {
    if (!sub) return;
    if (!bySub.has(sub)) bySub.set(sub, new Set());
    const dest = bySub.get(sub);
    for (const f of flagSet) dest.add(f);
  }

  for (const page of pages) {
    const url = String(page.url || '');
    const m = url.match(/\/docs\/git-([a-z0-9-]+)\/?$/i);
    const sub = m ? m[1] : null;
    const flags = parseFlagsFromManText(page.text);
    if (sub) addFlags(sub, flags);
    // Also index bare `git` page under ''
    if (/\/docs\/git\/?$/.test(url)) addFlags('git', flags);
  }

  if (useGitHelp) {
    const subs = new Set([...bySub.keys()]);
    // Common porcelain always probed when git exists
    for (const s of [
      'status', 'add', 'commit', 'branch', 'checkout', 'switch', 'merge', 'rebase',
      'reset', 'restore', 'revert', 'stash', 'pull', 'push', 'fetch', 'log', 'diff',
      'clone', 'init', 'tag', 'remote', 'cherry-pick', 'bisect', 'clean', 'reflog',
    ]) {
      subs.add(s);
    }
    for (const sub of subs) {
      if (sub === 'git') continue;
      const text = gitHelpText(sub);
      if (text) addFlags(sub, parseFlagsFromManText(text));
    }
  }

  const serialized = {};
  for (const [k, v] of bySub) {
    serialized[k] = [...v].sort();
  }
  return {
    builtAt: new Date().toISOString(),
    subcommands: serialized,
  };
}

/**
 * Persist oracle JSON under data/cache/sources/.
 */
export function writeManOracle(oracle, root = PACKAGE_ROOT) {
  mkdirSync(sourcesCacheDir(root), { recursive: true });
  const file = manOracleCachePath(root);
  writeFileSync(file, `${JSON.stringify(oracle, null, 2)}\n`);
  return file;
}

export function loadManOracle(root = PACKAGE_ROOT) {
  const file = manOracleCachePath(root);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * @param {object} oracle
 * @returns {(run: string) => { ok: boolean, reason?: string, unknown?: string[] }}
 */
export function makeFlagValidator(oracle) {
  const bySub = new Map(
    Object.entries(oracle?.subcommands || {}).map(([k, arr]) => [k, new Set(arr)]),
  );

  return function validateFlags(run) {
    const { subcommand, flags } = extractFlagsFromRun(run);
    if (!subcommand) return { ok: true };
    const allowed = bySub.get(subcommand);
    // If we have no oracle for this subcommand, fall open on allowlist-only (caller still validates subcommand).
    if (!allowed || allowed.size === 0) return { ok: true };
    const unknown = flags.filter((f) => {
      if (allowed.has(f)) return false;
      // Accept -u if --untracked-files style exists? keep strict on exact tokens.
      return true;
    });
    if (unknown.length) {
      return { ok: false, reason: 'unknown_flag', unknown };
    }
    return { ok: true };
  };
}
