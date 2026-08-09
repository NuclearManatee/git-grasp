import { describe, it, expect } from 'vitest';
import {
  inferFixtureForLeaf,
  concretizeCommandLine,
  materializeFixture,
  fixtureLabel,
  resolveFixture,
} from '../../../common/src/build/sandboxFixtures.ts';
import {
  createSandboxDirs,
  destroySandbox,
  addLocalRemote,
  validateInSandboxAndDestroy,
} from '../../../common/src/build/sandbox.ts';

describe('sandbox fixtures B+C', () => {
  it('infers bare_workdir for init leaves', () => {
    expect(
      inferFixtureForLeaf({ mapped_commands: ['git init'] }),
    ).toBe('bare_workdir');
  });

  it('concretizes placeholders', () => {
    expect(concretizeCommandLine('git switch -c <branch>')).toBe(
      'git switch -c feature',
    );
  });

  it('materializes bare_workdir without .git', () => {
    const s = createSandboxDirs({ workerId: 'fx', jobId: 'bare' });
    try {
      const mat = materializeFixture(s, 'bare_workdir');
      expect(mat.ok).toBe(true);
      expect(resolveFixture({ fixture: 'bare_workdir' })).toBe('bare_workdir');
      expect(fixtureLabel('inited')).toBe('fixture:inited');
    } finally {
      destroySandbox(s);
    }
  });

  it('runs recipe on fixture without freeform initial_state', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'with_commit',
      command_recipe: {
        commands: [{ command: 'git branch <branch>' }],
      },
      workerId: 'fx',
      jobId: 'recipe',
    });
    expect(result.ok).toBe(true);
  });

  it('bare_workdir accepts git init', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'bare_workdir',
      command_recipe: {
        commands: [{ command: 'git init' }],
      },
      workerId: 'fx',
      jobId: 'init',
    });
    expect(result.ok).toBe(true);
  });

  it('bare_workdir clones local seed url', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'bare_workdir',
      command_recipe: {
        commands: [{ command: 'git clone <url> demo' }],
      },
      workerId: 'fx',
      jobId: 'clone',
    });
    expect(result.ok).toBe(true);
  });

  it('with_tracked_file supports git rm', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'with_tracked_file',
      command_recipe: { commands: [{ command: 'git rm <file>' }] },
      workerId: 'fx',
      jobId: 'rm',
    });
    expect(result.ok).toBe(true);
  });

  it('staged_changes supports git commit', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'staged_changes',
      command_recipe: {
        commands: [{ command: 'git commit -m <message>' }],
      },
      workerId: 'fx',
      jobId: 'commit',
    });
    expect(result.ok).toBe(true);
  });

  it('two_branches supports git merge', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'two_branches',
      command_recipe: {
        commands: [{ command: 'git merge <branch>' }],
      },
      workerId: 'fx',
      jobId: 'merge',
    });
    expect(result.ok).toBe(true);
  });

  it('with_history supports rebase -i HEAD~1', () => {
    const result = validateInSandboxAndDestroy({
      fixture: 'with_history',
      command_recipe: {
        commands: [{ command: 'git rebase -i HEAD~1' }],
      },
      workerId: 'fx',
      jobId: 'rebase',
    });
    expect(result.ok).toBe(true);
  });

  it('with_remote materializes via addLocalRemote', () => {
    const s = createSandboxDirs({ workerId: 'fx', jobId: 'remote' });
    try {
      const mat = materializeFixture(s, 'with_remote', { addLocalRemote });
      expect(mat.ok).toBe(true);
    } finally {
      destroySandbox(s);
    }
  });
});
