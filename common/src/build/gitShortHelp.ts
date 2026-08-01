// @ts-nocheck
/**
 * Fetch short usage via `git <cmd> -h` (no browser / no man viewer).
 * Plain `git help <cmd>` must not be used at build time â€” it often opens HTML.
 */
import { spawnSync } from 'node:child_process';
import { spawnGit } from './gitExec.js';

/** @type {Map<string, { ok: boolean, text: string, metadata_source: string }>} */
const helpCache = new Map();

/** @internal test helper */
export function clearGitShortHelpCache() {
  helpCache.clear();
}

/**
 * @param {string} command e.g. `git status`
 * @param {{ spawnGit?: typeof spawnGit, timeoutMs?: number, cache?: boolean }} [opts]
 * @returns {{ ok: boolean, text: string, metadata_source: string }}
 */
export function fetchGitShortHelp(command, opts = {}) {
  const spawn = opts.spawnGit || spawnGit;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const useCache = opts.cache !== false;
  const parts = String(command || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 1) {
    return { ok: false, text: '', metadata_source: 'git/-h/unknown' };
  }

  // Standalone tools (gitk, scalar): `<bin> -h` — not `git <name> -h`.
  if (parts[0] !== 'git') {
    const bin = parts[0];
    const metadata_source = `git/-h/${bin}`;
    const cacheKey = `standalone:${bin}`.toLowerCase();
    if (useCache && helpCache.has(cacheKey)) {
      return helpCache.get(cacheKey);
    }
    const r = spawnSync(bin, ['-h'], {
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      shell: false,
      maxBuffer: 2 * 1024 * 1024,
    });
    const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
    const result = !text
      ? { ok: false, text: '', metadata_source }
      : { ok: true, text, metadata_source };
    if (useCache) helpCache.set(cacheKey, result);
    return result;
  }

  if (parts.length < 2) {
    return { ok: false, text: '', metadata_source: 'git/-h/unknown' };
  }
  const name = parts.slice(1).join(' ');
  const metadata_source = `git/-h/${name}`;
  const cacheKey = name.toLowerCase();
  if (useCache && helpCache.has(cacheKey)) {
    return helpCache.get(cacheKey);
  }

  // Always `-h` (short usage on stderr). Never `--help` / `git help` (HTML on Windows).
  const r = spawn([...parts.slice(1), '-h'], {
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  });
  const text = `${r.stdout || ''}${r.stderr || ''}`.trim();
  // Many git commands exit 129 for -h; treat non-empty usage as success.
  const result = !text
    ? { ok: false, text: '', metadata_source }
    : { ok: true, text, metadata_source };
  if (useCache) helpCache.set(cacheKey, result);
  return result;
}

/**
 * Build the canonical default block for an anchor.
 * @param {{ command: string, summary?: string }} entry
 * @param {{ spawnGit?: typeof spawnGit, timeoutMs?: number }} [opts]
 */
export function buildDefaultHelpBlock(entry, opts = {}) {
  const command = entry.command;
  const summary = (entry.summary || '').trim();
  const help = fetchGitShortHelp(command, opts);
  const body = [summary, help.text].filter(Boolean).join('\n\n');
  const content = `[git -h > ${command}]\n${body || `(no short help available for ${command})`}`;
  return {
    metadata_source: help.metadata_source,
    content,
    ok: help.ok || Boolean(summary),
  };
}
