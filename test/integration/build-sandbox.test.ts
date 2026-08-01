import { describe, it, expect } from 'bun:test';
import {
  validateInSandboxAndDestroy,
  createSandboxDirs,
  destroySandbox,
  addLocalRemote,
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

  it('blocks GUI commands without spawning a window', () => {
    const started = Date.now();
    const result = validateInSandboxAndDestroy({
      initial_state: 'git commit --allow-empty -m "init"\n',
      command_recipe: { commands: [{ command: 'git citool' }] },
      workerId: 'gui',
      jobId: 'citool',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('sandbox_gui_blocked');
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
