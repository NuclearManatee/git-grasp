// @ts-nocheck
/**
 * Structured sandbox fixtures (B+C): LLM picks an enum; code materializes state.
 * No freeform initial_state scripts from the model on the product path.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { gitInRepo } from './physicalHash.js';
import { spawnGit } from './gitExec.js';
import {
  SANDBOX_FIXTURES,
  SandboxFixtureSchema,
} from '../schemas/recipe.js';

export { SANDBOX_FIXTURES, SandboxFixtureSchema };

/**
 * Infer preferred fixture from leaf mapped commands (hint for prompts / fallback).
 */
export function inferFixtureForLeaf(leaf) {
  const cmds = (leaf?.mapped_commands || []).map((c) =>
    String(c).toLowerCase(),
  );
  const joined = cmds.join(' ');
  if (/\bgit clone\b/.test(joined) || /\bgit init\b/.test(joined)) {
    return 'bare_workdir';
  }
  if (/\b(push|pull|fetch)\b/.test(joined)) return 'with_remote';
  if (/\b(rm|mv)\b/.test(joined)) return 'with_tracked_file';
  if (/\bcommit\b/.test(joined)) return 'staged_changes';
  if (/\bmerge\b/.test(joined)) return 'two_branches';
  if (/\brebase\b/.test(joined)) return 'with_history';
  if (/\b(status|diff|add)\b/.test(joined)) return 'dirty_worktree';
  if (/\b(log|show|checkout|switch|branch|reset|tag)\b/.test(joined)) {
    return 'with_commit';
  }
  return 'inited';
}

export function applySandboxIdentity(work) {
  gitInRepo(work, ['config', 'user.name', 'git-grasp-sandbox']);
  gitInRepo(work, ['config', 'user.email', 'sandbox@git-grasp.local']);
  gitInRepo(work, ['config', 'commit.gpgsign', 'false']);
}

function fail(id, reason, stderr) {
  return { ok: false, reason, label: `fixture:${id}`, stderr: stderr || '' };
}

function writeTrackedFiles(work) {
  writeFileSync(path.join(work, 'notes.txt'), 'notes\n', 'utf8');
  writeFileSync(path.join(work, 'other.txt'), 'other\n', 'utf8');
  mkdirSync(path.join(work, 'subdir'), { recursive: true });
  const add = gitInRepo(work, ['add', 'notes.txt', 'other.txt']);
  if (!add.ok) return add;
  return gitInRepo(work, ['commit', '-m', 'add files']);
}

/**
 * Seed a local bare repo under sandbox.remotes for clone recipes.
 * Sets sandbox.cloneUrl to the bare path.
 */
export function seedCloneSource(sandbox) {
  mkdirSync(sandbox.remotes, { recursive: true });
  const bare = path.join(sandbox.remotes, 'source.git');
  const initBare = spawnGit(['init', '--bare', bare]);
  if (initBare.status !== 0) {
    throw new Error(`clone source bare init failed: ${initBare.stderr}`);
  }
  const seed = path.join(sandbox.root, 'clone-seed');
  mkdirSync(seed, { recursive: true });
  const init = gitInRepo(seed, ['init']);
  if (!init.ok) throw new Error(init.stderr);
  applySandboxIdentity(seed);
  writeFileSync(path.join(seed, 'README.md'), 'seed\n', 'utf8');
  gitInRepo(seed, ['add', 'README.md']);
  const commit = gitInRepo(seed, ['commit', '-m', 'seed']);
  if (!commit.ok) throw new Error(commit.stderr);
  gitInRepo(seed, ['remote', 'add', 'origin', bare]);
  const push = gitInRepo(seed, ['push', '-u', 'origin', 'HEAD']);
  if (!push.ok) throw new Error(push.stderr);
  sandbox.cloneUrl = bare;
  return bare;
}

/**
 * @param {(sandbox: object, name?: string) => string} [opts.addLocalRemote]
 * @param {(sandbox: object) => void} [opts.configureTools]
 */
export function materializeFixture(sandbox, fixture, opts = {}) {
  const id = SandboxFixtureSchema.parse(fixture || 'inited');
  const work = sandbox.work;
  const configureTools = opts.configureTools;
  const addLocalRemote = opts.addLocalRemote;

  if (id === 'bare_workdir') {
    try {
      seedCloneSource(sandbox);
    } catch (e) {
      return fail(id, 'fixture_clone_source', e?.message || String(e));
    }
    return { ok: true, label: 'fixture:bare_workdir' };
  }

  const init = gitInRepo(work, ['init']);
  if (!init.ok) return fail(id, 'git_init', init.stderr);
  applySandboxIdentity(work);
  if (typeof configureTools === 'function') configureTools(sandbox);

  if (id === 'inited') {
    return { ok: true, label: 'fixture:inited' };
  }

  if (id === 'with_commit' || id === 'dirty_worktree' || id === 'with_remote') {
    const commit = gitInRepo(work, ['commit', '--allow-empty', '-m', 'init']);
    if (!commit.ok) return fail(id, 'fixture_commit', commit.stderr);
  }

  if (id === 'with_tracked_file' || id === 'staged_changes' || id === 'two_branches' || id === 'with_history') {
    const tracked = writeTrackedFiles(work);
    if (!tracked.ok) return fail(id, 'fixture_tracked', tracked.stderr);
  }

  if (id === 'with_history') {
    const c2 = gitInRepo(work, ['commit', '--allow-empty', '-m', 'second']);
    if (!c2.ok) return fail(id, 'fixture_history', c2.stderr);
    return { ok: true, label: 'fixture:with_history' };
  }

  if (id === 'staged_changes') {
    writeFileSync(path.join(work, 'notes.txt'), 'notes\nstaged edit\n', 'utf8');
    const add = gitInRepo(work, ['add', 'notes.txt']);
    if (!add.ok) return fail(id, 'fixture_stage', add.stderr);
    return { ok: true, label: 'fixture:staged_changes' };
  }

  if (id === 'two_branches') {
    const br = gitInRepo(work, ['checkout', '-b', 'feature']);
    if (!br.ok) return fail(id, 'fixture_branch', br.stderr);
    writeFileSync(path.join(work, 'notes.txt'), 'notes\nfeature\n', 'utf8');
    gitInRepo(work, ['add', 'notes.txt']);
    const fc = gitInRepo(work, ['commit', '-m', 'feature']);
    if (!fc.ok) return fail(id, 'fixture_feature_commit', fc.stderr);
    const back = gitInRepo(work, ['checkout', '-']);
    if (!back.ok) return fail(id, 'fixture_checkout_main', back.stderr);
    return { ok: true, label: 'fixture:two_branches' };
  }

  if (id === 'with_tracked_file') {
    return { ok: true, label: 'fixture:with_tracked_file' };
  }

  if (id === 'dirty_worktree') {
    writeFileSync(path.join(work, 'notes.txt'), 'dirty\n', 'utf8');
    return { ok: true, label: 'fixture:dirty_worktree' };
  }

  if (id === 'with_remote') {
    if (typeof addLocalRemote !== 'function') {
      return fail(id, 'fixture_remote', 'addLocalRemote required');
    }
    try {
      addLocalRemote(sandbox, 'origin');
      gitInRepo(work, ['push', '-u', 'origin', 'HEAD']);
    } catch (e) {
      return fail(id, 'fixture_remote', e?.message || String(e));
    }
    return { ok: true, label: 'fixture:with_remote' };
  }

  return { ok: true, label: `fixture:${id}` };
}

/** Placeholder → concrete demo tokens for sandbox execution. */
export const PLACEHOLDER_DEFAULTS = {
  branch: 'feature',
  name: 'feature',
  message: 'update',
  msg: 'update',
  file: 'notes.txt',
  file1: 'notes.txt',
  file2: 'other.txt',
  path: 'notes.txt',
  'old-file': 'notes.txt',
  old_file: 'notes.txt',
  oldfile: 'notes.txt',
  'new-file': 'renamed.txt',
  new_file: 'renamed.txt',
  newfile: 'renamed.txt',
  directory: 'subdir',
  dir: 'subdir',
  remote: 'origin',
  tag: 'v1.0.0',
  commit: 'HEAD~1',
  url: 'https://example.com/repo.git',
};

/**
 * Replace <branch>-style placeholders (hyphens allowed) so sandbox argv is concrete.
 */
export function concretizeCommandLine(line, defaults = PLACEHOLDER_DEFAULTS) {
  return String(line || '').replace(/<([a-zA-Z_][a-zA-Z0-9_-]*)>/g, (_, key) => {
    const k = key.toLowerCase();
    if (defaults[k] != null) return String(defaults[k]);
    if (defaults[key] != null) return String(defaults[key]);
    return 'demo';
  });
}

export function concretizeCommands(commands, defaults = PLACEHOLDER_DEFAULTS) {
  return (commands || []).map((s) => ({
    ...s,
    command: concretizeCommandLine(s.command, defaults),
    comment: s.comment,
  }));
}

export function fixtureLabel(fixture) {
  return `fixture:${SandboxFixtureSchema.parse(fixture || 'inited')}`;
}

export function resolveFixture(recipeOrInput) {
  if (!recipeOrInput) return null;
  if (recipeOrInput.fixture) {
    const p = SandboxFixtureSchema.safeParse(recipeOrInput.fixture);
    if (p.success) return p.data;
  }
  const initial = String(recipeOrInput.initial_state || '').trim();
  const m = /^fixture:([a-z_]+)$/.exec(initial);
  if (m) {
    const p = SandboxFixtureSchema.safeParse(m[1]);
    if (p.success) return p.data;
  }
  return null;
}
