import { describe, it, expect } from 'vitest';
import {
  fetchGitShortHelp,
  buildDefaultHelpBlock,
} from '../../../common/src/build/gitShortHelp.ts';
import { ensureDefaultHelpBlocks } from '../../../common/src/build/prepare.ts';

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

  it('ensureDefaultHelpBlocks covers every taxonomy command with -h first', () => {
    const tax = [
      { command: 'git status', summary: 'Show status' },
      { command: 'git gc', summary: 'Cleanup' },
    ];
    const routed = [
      {
        command: 'git status',
        blocks: [{ metadata_source: 'tldr', content: 'extra status docs' }],
      },
    ];
    const out = ensureDefaultHelpBlocks(tax, routed, {
      buildDefault: (entry) => ({
        metadata_source: `git/-h/${entry.command.replace(/^git /, '')}`,
        content: `[git -h > ${entry.command}]\n${entry.summary}`,
        ok: true,
      }),
    });
    expect(out).toHaveLength(2);
    expect(out.map((b) => b.command)).toEqual(['git gc', 'git status']);
    const status = out.find((b) => b.command === 'git status');
    expect(status.blocks[0].metadata_source).toBe('git/-h/status');
    expect(status.blocks.map((b) => b.metadata_source)).toContain('tldr');
    expect(status.blocks.map((b) => b.metadata_source)).toContain('goal-stub/status');
    const gc = out.find((b) => b.command === 'git gc');
    expect(gc.blocks[0].metadata_source).toBe('git/-h/gc');
    expect(gc.blocks.some((b) => String(b.metadata_source).startsWith('goal-stub/'))).toBe(true);
  });
});
