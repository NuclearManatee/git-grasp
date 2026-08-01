// @ts-nocheck
/**
 * Ephemeral git sandboxes for validating initial_state + command_recipe.
 * Supports parallel workers: each job gets an exclusive temp directory.
 * GUI / editor side effects are stubbed headless (PATH + direct shim invoke).
 */
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  appendFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computePhysicalHash, gitInRepo } from './physicalHash.js';
import { parseCommands } from '../db/recipeFormat.js';
import { SANDBOX_COMMAND_TIMEOUT_MS } from '../db/constants.js';
import { spawnGit, isGitHelpViewerArgv, gitHeadlessEnv } from './gitExec.js';

/** Verbs that open a GUI / browser (classified for shim routing). */
export const SANDBOX_GUI_VERBS = new Set([
  'gui',
  'citool',
  'gitk',
  'gitweb',
  'difftool',
  'mergetool',
  'instaweb',
]);

const SHIM_NAMES = [
  'git-gui',
  'git-citool',
  'gitk',
  'git-gitweb',
  'git-instaweb',
  'grasp-difftool',
  'grasp-mergetool',
  'grasp-editor',
];

/**
 * True if the command would open a GUI, HTML help, or interactive tool.
 * @param {string} commandLine
 */
export function isSandboxGuiCommand(commandLine) {
  const line = String(commandLine || '').trim();
  if (!line) return false;
  if (/^gitk(\s|$)/i.test(line)) return true;
  const parts = line.split(/\s+/).filter(Boolean);
  if (parts[0] !== 'git' || parts.length < 2) return false;
  if (isGitHelpViewerArgv(parts)) return true;
  let i = 1;
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

/** No-op editor command for headless Git (exit 0). Mingw Git needs a POSIX script path. */
export function sandboxEditorCommand(sandbox) {
  if (!sandbox?.shims) return 'true';
  return path.join(sandbox.shims, 'grasp-editor').replace(/\\/g, '/');
}

/**
 * Env for sandbox spawns: PATH shims, EDITOR family, remotes, headless git.
 * @param {object} sandbox
 * @param {Record<string, string|undefined>} [extra]
 */
export function sandboxSpawnEnv(sandbox, extra = {}) {
  const editor = sandboxEditorCommand(sandbox);
  const pathSep = process.platform === 'win32' ? ';' : ':';
  const prevPath = process.env.PATH || process.env.Path || '';
  const shimPath = sandbox?.shims ? `${sandbox.shims}${pathSep}${prevPath}` : prevPath;
  return gitHeadlessEnv({
    ...extra,
    PATH: shimPath,
    Path: shimPath,
    GIT_EDITOR: editor,
    EDITOR: editor,
    VISUAL: editor,
    GIT_SEQUENCE_EDITOR: editor,
    GIT_GRASP_REMOTES: sandbox?.remotes || extra.GIT_GRASP_REMOTES,
    // Prefer text help when possible
    GIT_HELP_FORMAT: 'man',
  });
}

function writeShimScript(filePath, logPath, exitCode = 0) {
  if (process.platform === 'win32') {
    // .cmd: log argv then exit
    const body = [
      '@echo off',
      `>>"${logPath}" echo %~nx0 %*`,
      `exit /b ${exitCode}`,
      '',
    ].join('\r\n');
    writeFileSync(filePath, body, 'utf8');
    return;
  }
  const body = [
    '#!/bin/sh',
    `echo "$(basename "$0") $*" >> "${logPath}"`,
    `exit ${exitCode}`,
    '',
  ].join('\n');
  writeFileSync(filePath, body, 'utf8');
  try {
    chmodSync(filePath, 0o755);
  } catch {
    /* ignore */
  }
}

/**
 * Install headless shims into sandbox.shims. Overwrites.
 * @param {object} sandbox
 * @param {{ exitCode?: number, hang?: boolean }} [opts]
 */
export function installSandboxShims(sandbox, opts = {}) {
  const exitCode = opts.exitCode ?? 0;
  mkdirSync(sandbox.shims, { recursive: true });
  const logPath = sandbox.shimLog;
  writeFileSync(logPath, '', 'utf8');
  for (const name of SHIM_NAMES) {
    if (name === 'grasp-editor') {
      // Always POSIX script — mingw `git` invokes EDITOR via sh, not cmd.exe
      const file = path.join(sandbox.shims, 'grasp-editor');
      if (opts.hang) writeHangShimScriptUnix(file, logPath);
      else writeShimScriptUnix(file, logPath, exitCode);
      continue;
    }
    const file =
      process.platform === 'win32'
        ? path.join(sandbox.shims, `${name}.cmd`)
        : path.join(sandbox.shims, name);
    if (opts.hang) {
      writeHangShimScript(file, logPath);
    } else {
      writeShimScript(file, logPath, exitCode);
    }
  }
  return sandbox;
}

function writeShimScriptUnix(filePath, logPath, exitCode = 0) {
  const body = [
    '#!/bin/sh',
    `echo "$(basename "$0") $*" >> "${logPath.replace(/\\/g, '/')}"`,
    `exit ${exitCode}`,
    '',
  ].join('\n');
  writeFileSync(filePath, body, 'utf8');
  try {
    chmodSync(filePath, 0o755);
  } catch {
    /* ignore */
  }
}

function writeHangShimScriptUnix(filePath, logPath) {
  const body = [
    '#!/bin/sh',
    `echo "$(basename "$0") hang $*" >> "${logPath.replace(/\\/g, '/')}"`,
    'sleep 120',
    'exit 1',
    '',
  ].join('\n');
  writeFileSync(filePath, body, 'utf8');
  try {
    chmodSync(filePath, 0o755);
  } catch {
    /* ignore */
  }
}

function writeHangShimScript(filePath, logPath) {
  if (process.platform === 'win32') {
    const body = [
      '@echo off',
      `>>"${logPath}" echo %~nx0 hang %*`,
      'ping -n 120 127.0.0.1 >nul',
      'exit /b 1',
      '',
    ].join('\r\n');
    writeFileSync(filePath, body, 'utf8');
    return;
  }
  const body = [
    '#!/bin/sh',
    `echo "$(basename "$0") hang $*" >> "${logPath}"`,
    'sleep 120',
    'exit 1',
    '',
  ].join('\n');
  writeFileSync(filePath, body, 'utf8');
  try {
    chmodSync(filePath, 0o755);
  } catch {
    /* ignore */
  }
}

/**
 * Read shim invocation log (one line per call).
 * @param {object} sandbox
 */
export function readShimLog(sandbox) {
  if (!sandbox?.shimLog || !existsSync(sandbox.shimLog)) return [];
  return readFileSync(sandbox.shimLog, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
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
  const shims = path.join(root, 'shims', job);
  mkdirSync(work, { recursive: true });
  mkdirSync(remotes, { recursive: true });
  mkdirSync(shims, { recursive: true });
  const sandbox = {
    root,
    work,
    remotes,
    shims,
    shimLog: path.join(root, 'shims', job, 'shim-log.txt'),
    worker,
    job,
  };
  installSandboxShims(sandbox);
  return sandbox;
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

/**
 * Map a GUI/help recipe line to a shim binary name (without extension).
 * @param {string} line
 * @returns {string|null}
 */
export function guiShimNameForCommand(line) {
  const trimmed = String(line || '').trim();
  if (/^gitk(\s|$)/i.test(trimmed)) return 'gitk';
  const parts = tokenizeGitArgv(trimmed);
  if (parts[0] !== 'git') return null;
  if (isGitHelpViewerArgv(parts)) return 'grasp-editor';
  let i = 1;
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
  if (verb === 'gui') return 'git-gui';
  if (verb === 'citool') return 'git-citool';
  if (verb === 'gitk') return 'gitk';
  if (verb === 'gitweb') return 'git-gitweb';
  if (verb === 'instaweb') return 'git-instaweb';
  if (verb === 'difftool') return 'grasp-difftool';
  if (verb === 'mergetool') return 'grasp-mergetool';
  return null;
}

function shimPath(sandbox, name) {
  if (name === 'grasp-editor') {
    return path.join(sandbox.shims, 'grasp-editor');
  }
  return process.platform === 'win32'
    ? path.join(sandbox.shims, `${name}.cmd`)
    : path.join(sandbox.shims, name);
}

/**
 * Run GUI/help via shim (does not open a real window).
 * @param {object} sandbox
 * @param {string} line
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {{ ok: boolean, status: number, stdout: string, stderr: string, timedOut?: boolean }|null}
 */
export function runGuiShim(sandbox, line, opts = {}) {
  const name = guiShimNameForCommand(line);
  if (!name) return null;
  const bin = shimPath(sandbox, name);
  const parts = tokenizeGitArgv(line);
  // Pass through args after the verb for logging realism
  let verbIdx = 1;
  if (parts[0] === 'git') {
    while (verbIdx < parts.length) {
      const p = parts[verbIdx];
      if (p === '-C' || p === '-c') {
        verbIdx += 2;
        continue;
      }
      if (p.startsWith('-')) {
        verbIdx += 1;
        continue;
      }
      break;
    }
  } else {
    verbIdx = 0;
  }
  const args = parts[0] === 'git' ? parts.slice(verbIdx + 1) : parts.slice(1);
  const timeoutMs = opts.timeoutMs ?? SANDBOX_COMMAND_TIMEOUT_MS;
  const r = spawnSync(bin, args, spawnOpts({
    cwd: sandbox.work,
    env: sandboxSpawnEnv(sandbox),
    shell: process.platform === 'win32',
    timeout: timeoutMs,
  }));
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
  return {
    ok: !r.error && r.status === 0,
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: timedOut
      ? `${r.stderr || ''}\nsandbox_timeout: ${line}`.trim()
      : r.stderr || String(r.error || ''),
    timedOut,
  };
}

function runShellScript(cwd, script, env = {}) {
  const normalized = script.replace(/\r\n/g, '\n');
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
  return line.replace(/-m\s+'([^']*)'/g, '-m "$1"').replace(/-m\s+'([^']*)'/g, '-m "$1"');
}

/**
 * Split a simple `git …` line into argv without a shell.
 */
export function tokenizeGitArgv(line) {
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

function expandSandboxVars(line, env = {}) {
  return String(line || '')
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, k) => (env[k] != null ? String(env[k]) : ''))
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, k) => (env[k] != null ? String(env[k]) : ''));
}

function runScriptLineByLine(cwd, script, env) {
  const lines = script
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  let stdout = '';
  let stderr = '';
  const sandbox = env.__sandbox;
  const blockGui = env.__blockGui === true;
  for (const rawLine of lines) {
    if (/\s(&&|\|\||;)\s/.test(rawLine)) {
      return {
        ok: false,
        status: 1,
        stdout,
        stderr: `shell_meta_in_initial_state: ${rawLine}`,
      };
    }
    let line = process.platform === 'win32' ? normalizeWindowsGitLine(rawLine) : rawLine;
    line = expandSandboxVars(line, env);
    if (isSandboxGuiCommand(line)) {
      if (blockGui) {
        return {
          ok: false,
          status: 1,
          stdout,
          stderr: `sandbox_gui_blocked: ${line}`,
        };
      }
      if (sandbox) {
        const shimmed = runGuiShim(sandbox, line, {
          timeoutMs: env.__commandTimeoutMs,
        });
        if (shimmed) {
          stdout += shimmed.stdout;
          stderr += shimmed.stderr;
          if (!shimmed.ok) {
            return { ok: false, status: shimmed.status, stdout, stderr };
          }
          continue;
        }
      }
    }
    let r;
    if (/^git(\s|$)/.test(line)) {
      const argv = tokenizeGitArgv(line);
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

function configureSandboxTools(sandbox) {
  const diffCmd = shimPath(sandbox, 'grasp-difftool');
  const mergeCmd = shimPath(sandbox, 'grasp-mergetool');
  gitInRepo(sandbox.work, ['config', 'diff.tool', 'grasp']);
  gitInRepo(sandbox.work, ['config', 'difftool.grasp.cmd', `"${diffCmd}" "$LOCAL" "$REMOTE"`]);
  gitInRepo(sandbox.work, ['config', 'difftool.prompt', 'false']);
  gitInRepo(sandbox.work, ['config', 'merge.tool', 'grasp']);
  gitInRepo(sandbox.work, ['config', 'mergetool.grasp.cmd', `"${mergeCmd}" "$LOCAL" "$REMOTE" "$MERGED"`]);
  gitInRepo(sandbox.work, ['config', 'mergetool.prompt', 'false']);
  gitInRepo(sandbox.work, ['config', 'mergetool.grasp.trustExitCode', 'true']);
}

/**
 * @param {{
 *   initial_state: string,
 *   command_recipe: object|string,
 *   workerId?: any,
 *   jobId?: any,
 *   blockGui?: boolean,
 *   shimExitCode?: number,
 *   hangShims?: boolean,
 *   commandTimeoutMs?: number,
 * }} input
 */
export function validateInSandbox(input) {
  const blockGui = input.blockGui === true;
  const sandbox = createSandboxDirs({
    workerId: input.workerId,
    jobId: input.jobId,
  });
  if (input.hangShims) {
    installSandboxShims(sandbox, { hang: true });
  } else if (input.shimExitCode != null && input.shimExitCode !== 0) {
    installSandboxShims(sandbox, { exitCode: input.shimExitCode });
  }
  const timeoutMs = input.commandTimeoutMs ?? SANDBOX_COMMAND_TIMEOUT_MS;
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
    if (!blockGui) configureSandboxTools(sandbox);

    const env = {
      ...sandboxSpawnEnv(sandbox),
      __sandbox: sandbox,
      __blockGui: blockGui,
      __commandTimeoutMs: timeoutMs,
    };
    const stateRun = runShellScript(sandbox.work, input.initial_state, env);
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
      let line =
        process.platform === 'win32'
          ? normalizeWindowsGitLine(step.command)
          : step.command;
      line = expandSandboxVars(line, sandboxSpawnEnv(sandbox));

      if (isSandboxGuiCommand(line)) {
        if (blockGui) {
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
        const shimmed = runGuiShim(sandbox, line, { timeoutMs });
        if (shimmed) {
          if (!shimmed.ok) {
            return {
              ok: false,
              reason: shimmed.timedOut ? 'sandbox_timeout' : 'command_recipe',
              failedCommand: step.command,
              stdout: shimmed.stdout,
              stderr: shimmed.stderr,
              sandbox,
              initial_state_physical_hash: initialHash,
            };
          }
          continue;
        }
      }

      let r;
      if (/^git(\s|$)/.test(line)) {
        const argv = tokenizeGitArgv(line);
        r = spawnGit(
          argv.slice(1),
          spawnOpts({
            cwd: sandbox.work,
            env: sandboxSpawnEnv(sandbox),
            timeout: timeoutMs,
          }),
        );
      } else {
        const argv = tokenizeGitArgv(line);
        r = spawnSync(
          argv[0],
          argv.slice(1),
          spawnOpts({
            cwd: sandbox.work,
            shell: process.platform === 'win32',
            env: sandboxSpawnEnv(sandbox),
            timeout: timeoutMs,
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
