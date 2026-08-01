import { describe, it, expect } from 'bun:test';
import {
  validateInSandboxAndDestroy,
  createSandboxDirs,
  destroySandbox,
  addLocalRemote,
  readShimLog,
  sandboxSpawnEnv,
} from '../../common/src/build/sandbox.js';
import { computePhysicalHash, gitInRepo } from '../../common/src/build/physicalHash.js';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

describe('sandbox + physical hash', () => {
  it('validates a simple recipe', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m "init"\n',
      command_recipe: { commands: [{ command: 'git status' }] },
      workerId: 't1',
      jobId: 'j1',
    });
    expect(result.ok).toBe(true);
    expect(result.initial_state_physical_hash).toBeTruthy();
    expect(result.final_state_physical_hash).toBeTruthy();
  });

  it('hash is stable for same state', () => {
    const s = createSandboxDirs({ workerId: 'h', jobId: '1' });
    gitInRepo(s.work, ['init']);
    gitInRepo(s.work, ['config', 'user.name', 't']);
    gitInRepo(s.work, ['config', 'user.email', 't@t']);
    gitInRepo(s.work, ['commit', '--allow-empty', '-m', 'x']);
    const a = computePhysicalHash(s.work);
    const b = computePhysicalHash(s.work);
    expect(a).toBe(b);
    destroySandbox(s);
  });

  it('supports local bare remotes', () => {
    const s = createSandboxDirs({ workerId: 'r', jobId: '1' });
    gitInRepo(s.work, ['init']);
    gitInRepo(s.work, ['config', 'user.name', 't']);
    gitInRepo(s.work, ['config', 'user.email', 't@t']);
    addLocalRemote(s, 'origin');
    const remotes = gitInRepo(s.work, ['remote', '-v']);
    expect(remotes.stdout).toContain('origin');
    destroySandbox(s);
  });

  it('runs parallel sandboxes without clash', async () => {
    const jobs = Array.from({ length: 4 }, (_, i) =>
      Promise.resolve(
        validateInSandboxAndDestroy({
          initial_state: 'git commit --allow-empty -m "init"\n',
          command_recipe: { commands: [{ command: 'git status' }] },
          workerId: i,
          jobId: `p-${i}`,
        }),
      ),
    );
    const results = await Promise.all(jobs);
    expect(results.every((r) => r.ok)).toBe(true);
    const hashes = new Set(results.map((r) => r.final_state_physical_hash));
    expect(hashes.size).toBeGreaterThanOrEqual(1);
  });

  it('accepts GUI recipes via PATH shims without hanging', () => {
    for (const command of ['git gui', 'git citool', 'gitk', 'git difftool', 'git mergetool']) {
      const started = Date.now();
      const result = validateInSandboxAndDestroy({
        initial_state: 'git commit --allow-empty -m "init"\n',
        command_recipe: { commands: [{ command }] },
        workerId: 'gui',
        jobId: command.replace(/\s+/g, '-'),
      });
      expect(result.ok).toBe(true);
      expect(Date.now() - started).toBeLessThan(10_000);
    }
  });

  it('blockGui opt-in still fails closed', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m "init"\n',
      command_recipe: { commands: [{ command: 'git citool' }] },
      blockGui: true,
      workerId: 'gui',
      jobId: 'block',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sandbox_gui_blocked');
  });

  it('push/pull with $GIT_GRASP_REMOTES', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: [
        'git commit --allow-empty -m init',
        'git init --bare "$GIT_GRASP_REMOTES/origin.git"',
        'git remote add origin "$GIT_GRASP_REMOTES/origin.git"',
        'git push -u origin HEAD',
      ].join('\n'),
      command_recipe: { commands: [{ command: 'git pull' }] },
      workerId: 'remote',
      jobId: 'pull',
    });
    expect(result.ok).toBe(true);
  });

  it('describe --always succeeds', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git describe --always' }] },
      workerId: 'desc',
      jobId: '1',
    });
    expect(result.ok).toBe(true);
  });

  it('restore with path succeeds', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: [
        'git commit --allow-empty -m init',
        'echo hi > f.txt',
        'git add f.txt',
        'git commit -m add',
        'echo bye > f.txt',
      ].join('\n'),
      command_recipe: { commands: [{ command: 'git restore f.txt' }] },
      workerId: 'restore',
      jobId: '1',
    });
    expect(result.ok).toBe(true);
  });

  it('bugreport does not fail on EDITOR unset', () => {
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: {
        commands: [{ command: 'git bugreport --output-directory .' }],
      },
      workerId: 'bug',
      jobId: '1',
    });
    expect(result.ok).toBe(true);
  });

  it('hung shim is killed by timeout', () => {
    const started = Date.now();
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git gui' }] },
      hangShims: true,
      commandTimeoutMs: 800,
      workerId: 'hang',
      jobId: '1',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sandbox_timeout');
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('sets EDITOR family on spawn env', () => {
    const s = createSandboxDirs({ workerId: 'ed', jobId: '1' });
    try {
      const env = sandboxSpawnEnv(s);
      expect(env.GIT_EDITOR).toContain('grasp-editor');
      expect(env.EDITOR).toBe(env.GIT_EDITOR);
    } finally {
      destroySandbox(s);
    }
  });
});
