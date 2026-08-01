import { describe, it, expect } from 'vitest';
import {
  isGitHelpViewerArgv,
  resolveGitBin,
  resetGitBinCache,
} from '../../../packages/core/src/build/gitExec.ts';
import { isSandboxGuiCommand } from '../../../packages/core/src/build/sandbox.ts';
import {
  fetchGitShortHelp,
  clearGitShortHelpCache,
} from '../../../packages/core/src/build/gitShortHelp.ts';

describe('gitExec help-viewer detection', () => {
  it('flags git help <cmd> and --help', () => {
    expect(isGitHelpViewerArgv(['git', 'help', 'status'])).toBe(true);
    expect(isGitHelpViewerArgv(['git', 'status', '--help'])).toBe(true);
    expect(isGitHelpViewerArgv(['git', 'help'])).toBe(true);
  });

  it('allows help -a and short -h', () => {
    expect(isGitHelpViewerArgv(['git', 'help', '-a'])).toBe(false);
    expect(isGitHelpViewerArgv(['git', 'help', '--all'])).toBe(false);
    expect(isGitHelpViewerArgv(['git', 'status', '-h'])).toBe(false);
    expect(isGitHelpViewerArgv(['git', 'status'])).toBe(false);
  });

  it('sandbox blocks help viewers as gui', () => {
    expect(isSandboxGuiCommand('git status --help')).toBe(true);
    expect(isSandboxGuiCommand('git help commit')).toBe(true);
    expect(isSandboxGuiCommand('git status -h')).toBe(false);
  });
});

describe('git short help cache', () => {
  it('caches by verb', () => {
    clearGitShortHelpCache();
    let calls = 0;
    const spawnGit = () => {
      calls += 1;
      return { status: 129, stdout: '', stderr: 'usage: git status\n' };
    };
    fetchGitShortHelp('git status', { spawnGit });
    fetchGitShortHelp('git status', { spawnGit });
    expect(calls).toBe(1);
  });
});

describe('resolveGitBin', () => {
  it('returns a string', () => {
    resetGitBinCache();
    expect(typeof resolveGitBin()).toBe('string');
    expect(resolveGitBin().length).toBeGreaterThan(0);
  });
});
