// @ts-nocheck
/**
 * Ephemeral git sandboxes for validating initial_state + command_recipe.
 * Supports parallel workers: each job gets an exclusive temp directory.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computePhysicalHash, gitInRepo } from './physicalHash.js';
import { parseCommands } from '../db/recipeFormat.js';
import { SANDBOX_COMMAND_TIMEOUT_MS } from '../db/constants.js';
import { spawnGit, isGitHelpViewerArgv } from './gitExec.js';

/** Verbs that open a GUI / browser and would hang headless validation. */
const SANDBOX_GUI_VERBS = new Set([
  'gui',
  'citool',
  'gitk',
  'gitweb',
  'difftool',
  'mergetool',
]);

/**
 * True if the command would open a GUI, HTML help, or interactive tool (do not spawn).
 * @param {string} commandLine
 */
export function isSandboxGuiCommand(commandLine) {
  const line = String(commandLine || '').trim();
  if (!line) return false;
  // Standalone gitk binary
  if (/^gitk(\s|$)/i.test(line)) return true;
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts[0] !== 'git' || parts.length < 2) return false;
  if (isGitHelpViewerArgv(parts)) return true;
  let i = 1;
  // skip global opts before the verb: -C, -c, --git-dir=, etc.
  while (i < parts.length) {
    const p = parts[i];
    if (p === '-C' || p === '-c') {
      i += 2;
      continue;
    }
    if (p.startsWith('-')) {
      i += 1;
      continue;
    }
    break;
  }
  const verb = (parts[i] || '').toLowerCase();
  return SANDBOX_GUI_VERBS.has(verb);
}

function spawnOpts(extra = {}) {
  return {
    encoding: 'utf8',
    windowsHide: true,
    timeout: SANDBOX_COMMAND_TIMEOUT_MS,
    killSignal: 'SIGTERM',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...extra,
  };
}

/**
 * @param {{ workerId?: string|number, jobId?: string }} [opts]
 */
export function createSandboxDirs(opts = {}) {
  const worker = String(opts.workerId ?? process.pid);
  const job = String(opts.jobId ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const root = mkdtempSync(path.join(tmpdir(), `git-grasp-sandbox-${worker}-`));
  const work = path.join(root, 'work', job);
  const remotes = path.join(root, 'remotes', job);
  mkdirSync(work, { recursive: true });
  mkdirSync(remotes, { recursive: true });
  return { root, work, remotes, worker, job };
}

export function destroySandbox(sandbox) {
  if (sandbox?.root && existsSync(sandbox.root)) {
    try {
      rmSync(sandbox.root, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

function runShellScript(cwd, script, env = {}) {
  const normalized = script.replace(/\r\n/g, '\n');
  // Prefer line-by-line on Windows: `bash` often resolves to broken WSL stubs.
  if (process.platform === 'win32') {
    return runScriptLineByLine(cwd, normalized, env);
  }
  const file = path.join(cwd, '.git-grasp-initial-state.sh');
  writeFileSync(file, normalized, 'utf8');
  const r = spawnSync('/bin/bash', [file], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
    windowsHide: true,
  });
  if (r.error || r.status === null) {
    return runScriptLineByLine(cwd, normalized, env);
  }
  return {
    ok: r.status === 0,
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function normalizeWindowsGitLine(line) {
  // cmd.exe does not treat single quotes as string delimiters.
  return line.replace(/-m\s+'([^']*)'/g, '-m "$1"').replace(/-m\s+'([^']*)'/g, '-m "$1"');
}

/**
 * Split a simple `git â€¦` line into argv without a shell.
 * Supports double-quoted and single-quoted segments.
 */
function tokenizeGitArgv(line) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function runScriptLineByLine(cwd, script, env) {
  const lines = script
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  let stdout = '';
  let stderr = '';
  for (const rawLine of lines) {
    // Reject multi-command shell chains in initial_state (force regen).
    if (/\s(&&|\|\||;)\s/.test(rawLine)) {
      return {
        ok: false,
        status: 1,
        stdout,
        stderr: `shell_meta_in_initial_state: ${rawLine}`,
      };
    }
    const line = process.platform === 'win32' ? normalizeWindowsGitLine(rawLine) : rawLine;
    if (isSandboxGuiCommand(line)) {
      return {
        ok: false,
        status: 1,
        stdout,
        stderr: `sandbox_gui_blocked: ${line}`,
      };
    }
    let r;
    if (/^git(\s|$)/.test(line)) {
      const argv = tokenizeGitArgv(line);
      // Prefer resolved git.exe; drop leading "git" token from the line.
      r = spawnGit(argv.slice(1), spawnOpts({
        cwd,
        env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      }));
    } else {
      r = spawnSync(line, spawnOpts({
        cwd,
        shell: true,
        env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: '0' },
      }));
    }
    stdout += r.stdout || '';
    stderr += r.stderr || '';
    if (r.error || r.status === null || r.status !== 0) {
      const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
      return {
        ok: false,
        status: r.status ?? 1,
        stdout,
        stderr: timedOut
          ? `${stderr}\nsandbox_timeout: ${line}`.trim()
          : stderr || String(r.error || ''),
      };
    }
  }
  return { ok: true, status: 0, stdout, stderr };
}

/**
 * Create a local bare remote under sandbox.remotes and add it to work repo.
 */
export function addLocalRemote(sandbox, name = 'origin') {
  const bare = path.join(sandbox.remotes, `${name}.git`);
  mkdirSync(sandbox.remotes, { recursive: true });
  const init = spawnGit(['init', '--bare', bare]);
  if (init.status !== 0) {
    throw new Error(`bare remote init failed: ${init.stderr}`);
  }
  const add = gitInRepo(sandbox.work, ['remote', 'add', name, bare]);
  if (!add.ok) throw new Error(`remote add failed: ${add.stderr}`);
  return bare;
}

/**
 * @param {{ initial_state: string, command_recipe: object|string, workerId?: any, jobId?: any }} input
 */
export function validateInSandbox(input) {
  const sandbox = createSandboxDirs({
    workerId: input.workerId,
    jobId: input.jobId,
  });
  try {
    const init = gitInRepo(sandbox.work, ['init']);
    if (!init.ok) {
      return {
        ok: false,
        reason: 'git_init',
        stdout: init.stdout,
        stderr: init.stderr,
        sandbox,
      };
    }
    gitInRepo(sandbox.work, ['config', 'user.name', 'git-grasp-sandbox']);
    gitInRepo(sandbox.work, ['config', 'user.email', 'sandbox@git-grasp.local']);
    gitInRepo(sandbox.work, ['config', 'commit.gpgsign', 'false']);

    const stateRun = runShellScript(sandbox.work, input.initial_state, {
      GIT_GRASP_REMOTES: sandbox.remotes,
    });
    if (!stateRun.ok) {
      return {
        ok: false,
        reason: 'initial_state',
        stdout: stateRun.stdout,
        stderr: stateRun.stderr,
        sandbox,
      };
    }

    const initialHash = computePhysicalHash(sandbox.work);
    const steps = parseCommands(input.command_recipe);
    for (const step of steps) {
      const line =
        process.platform === 'win32'
          ? normalizeWindowsGitLine(step.command)
          : step.command;
      if (isSandboxGuiCommand(line)) {
        return {
          ok: false,
          reason: 'sandbox_gui_blocked',
          failedCommand: step.command,
          stdout: '',
          stderr: `sandbox_gui_blocked: ${line}`,
          sandbox,
          initial_state_physical_hash: initialHash,
        };
      }
      let r;
      if (/^git(\s|$)/.test(line)) {
        const argv = tokenizeGitArgv(line);
        r = spawnGit(
          argv.slice(1),
          spawnOpts({
            cwd: sandbox.work,
            env: { GIT_TERMINAL_PROMPT: '0' },
          }),
        );
      } else {
        r = spawnSync(
          line,
          spawnOpts({
            cwd: sandbox.work,
            shell: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          }),
        );
      }
      const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
      if (r.error || r.status === null || r.status !== 0) {
        return {
          ok: false,
          reason: timedOut ? 'sandbox_timeout' : 'command_recipe',
          failedCommand: step.command,
          stdout: r.stdout || '',
          stderr: timedOut
            ? `${r.stderr || ''}\nsandbox_timeout: ${line}`.trim()
            : r.stderr || String(r.error || ''),
          sandbox,
          initial_state_physical_hash: initialHash,
        };
      }
    }
    const finalHash = computePhysicalHash(sandbox.work);
    return {
      ok: true,
      initial_state_physical_hash: initialHash,
      final_state_physical_hash: finalHash,
      sandbox,
    };
  } finally {
    // caller may inspect; destroy after
  }
}

export function validateInSandboxAndDestroy(input) {
  const result = validateInSandbox(input);
  destroySandbox(result.sandbox);
  delete result.sandbox;
  return result;
}
