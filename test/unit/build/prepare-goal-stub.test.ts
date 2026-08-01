import { describe, it, expect } from 'vitest';
import {
  ensureDefaultHelpBlocks,
  buildGoalGapsReport,
} from '../../../common/src/build/prepare.ts';

describe('prepare goal stubs', () => {
  it('prepends -h then goal stub', () => {
    const blocks = ensureDefaultHelpBlocks(
      [{ command: 'git config', summary: 'Get and set options' }],
      [],
      {
        buildDefault: (e) => ({
          metadata_source: 'git/-h/config',
          content: `[git -h > ${e.command}]\nusage`,
          ok: true,
        }),
        rolesByCommand: new Map([['git config', ['identity']]]),
      },
    );
    expect(blocks[0].blocks).toHaveLength(2);
    expect(blocks[0].blocks[0].metadata_source).toBe('git/-h/config');
    expect(blocks[0].blocks[1].metadata_source).toBe('goal-stub/config');
    expect(blocks[0].blocks[1].content).toContain('identity');
  });

  it('reports goal gaps when no routed prose', () => {
    const blocks = ensureDefaultHelpBlocks(
      [{ command: 'git config', summary: 'Get and set options' }],
      [],
      {
        buildDefault: (e) => ({
          metadata_source: 'git/-h/config',
          content: 'x',
          ok: true,
        }),
        rolesByCommand: new Map([['git config', ['identity']]]),
      },
    );
    const gaps = buildGoalGapsReport(blocks, new Map([['git config', ['identity']]]));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].command).toBe('git config');
  });
});
