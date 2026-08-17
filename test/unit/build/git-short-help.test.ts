import { describe, it, expect } from 'bun:test';
import {
  fetchGitShortHelp,
  buildDefaultHelpBlock,
} from '../../../common/src/build/gitShortHelp.ts';

describe('git short help (-h)', () => {
  it('fetchGitShortHelp uses git <cmd> -h via spawn (no git help)', () => {
    let seen;
    const r = fetchGitShortHelp('git status', {
      cache: false,
      spawnGit: (args, opts) => {
        seen = { args, opts };
        return {
          status: 129,
          stdout: '',
          stderr: 'usage: git status [<options>]\n',
        };
      },
    });
    expect(seen.args).toEqual(['status', '-h']);
    expect(seen.args).not.toContain('help');
    expect(seen.args).not.toContain('--help');
    expect(r.ok).toBe(true);
    expect(r.metadata_source).toBe('git/-h/status');
    expect(r.text).toContain('usage: git status');
  });

  it('buildDefaultHelpBlock prepends path prefix and summary', () => {
    const block = buildDefaultHelpBlock(
      { command: 'git status', summary: 'Show the working tree status' },
      {
        cache: false,
        spawnGit: () => ({
          status: 129,
          stdout: '',
          stderr: 'usage: git status [<options>]\n',
        }),
      },
    );
    expect(block.metadata_source).toBe('git/-h/status');
    expect(block.content).toMatch(/^\[git -h > git status\]/);
    expect(block.content).toContain('Show the working tree status');
    expect(block.content).toContain('usage: git status');
  });
});
