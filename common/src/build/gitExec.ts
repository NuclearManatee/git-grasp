// @ts-nocheck
/**
 * Windows-safe git spawning for build/sandbox.
 * Prefer mingw64 git.exe (not the cmd\ wrapper), always hide consoles,
 * never open HTML help viewers.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let cachedGitBin = null;

/**
 * Absolute path to git when known; otherwise `"git"`.
 * Override with GIT_GRASP_GIT.
 */
export function resolveGitBin() {
  if (cachedGitBin) return cachedGitBin;
  if (process.env.GIT_GRASP_GIT && existsSync(process.env.GIT_GRASP_GIT)) {
    cachedGitBin = process.env.GIT_GRASP_GIT;
    return cachedGitBin;
  }
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidates = [
      path.join(pf, 'Git', 'mingw64', 'bin', 'git.exe'),
      path.join(pf86, 'Git', 'mingw64', 'bin', 'git.exe'),
      path.join(pf, 'Git', 'cmd', 'git.exe'),
      path.join(pf86, 'Git', 'cmd', 'git.exe'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) {
        cachedGitBin = c;
        return cachedGitBin;
      }
    }
  }
  cachedGitBin = 'git';
  return cachedGitBin;
}

/** @internal test helper */
export function resetGitBinCache() {
  cachedGitBin = null;
}

/**
 * Env that keeps git headless (no pager / prompt).
 * @param {Record<string, string|undefined>} [extra]
 */
export function gitHeadlessEnv(extra = {}) {
  return {
    ...process.env,
    ...extra,
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
    PAGER: 'cat',
    MANPAGER: 'cat',
  };
}

/**
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding & { bin?: string }} [opts]
 */
export function spawnGit(args, opts = {}) {
  const { bin = resolveGitBin(), env, ...rest } = opts;
  return spawnSync(bin, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...rest,
    env: gitHeadlessEnv(env || {}),
  });
}

/**
 * True if argv would open HTML help / man / browser on typical Git-for-Windows.
 * `git help -a/--all` lists to stdout and is safe; `git help <cmd>` and `--help` are not.
 * @param {string[]} argv full argv including leading `git` or bare subcommand list
 */
export function isGitHelpViewerArgv(argv) {
  const parts = (argv || []).map(String);
  const start =
    parts[0] === 'git' || /\bgit(\.exe)?$/i.test(parts[0] || '') ? 1 : 0;
  const body = parts.slice(start);
  if (body.includes('--help')) return true;
  if (body[0] !== 'help') return false;
  const rest = body.slice(1).filter((a) => a !== '--');
  if (rest.length === 0) return true;
  if (rest[0] === '-a' || rest[0] === '--all') return false;
  if (rest[0] === '-g' || rest[0] === '--guides') return false;
  // -i/-m/-w and bare command names open a viewer
  return true;
}
