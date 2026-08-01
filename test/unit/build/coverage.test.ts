import { describe, it, expect } from 'vitest';
import {
  verbsInRecipe,
  verbFromCommandLine,
  flagsFromCommandLine,
  parseFlagsFromHelp,
  stateBucket,
  buildVerbCoverage,
  weakestAxis,
  allVerbsSaturated,
  assignMutationKind,
  sameStepVerbs,
} from '../../../common/src/build/coverage.ts';
import { LOOP_SATURATION_K as K } from '../../../common/src/db/constants.ts';

describe('coverage helpers', () => {
  it('extracts verbs and flags', () => {
    expect(verbFromCommandLine('git rebase -i HEAD~3')).toBe('git rebase');
    expect(verbsInRecipe({
      command_recipe: {
        commands: [
          { command: 'git stash' },
          { command: 'git rebase -i' },
          { command: 'git push' },
        ],
      },
    })).toEqual(['git push', 'git rebase', 'git stash']);
    expect(flagsFromCommandLine('git status -sb --porcelain')).toEqual([
      '--porcelain',
      '-sb',
    ]);
  });

  it('parses flags from -h text', () => {
    const help = `usage: git status
    -s, --short
    --porcelain[=<version>]
`;
    const flags = parseFlagsFromHelp(help);
    expect(flags.has('--short')).toBe(true);
    expect(flags.has('--porcelain')).toBe(true);
  });

  it('classifies state buckets', () => {
    expect(stateBucket('git commit --allow-empty -m init\n')).toBe('minimal');
    expect(stateBucket('echo x > f\ngit add f\n')).toBe('dirty_worktree');
    expect(stateBucket('git remote add origin $GIT_GRASP_REMOTES/a\n')).toBe('with_remote');
    expect(stateBucket('git checkout --detach HEAD\n')).toBe('detached_or_diverged');
  });

  it('multi-bucket coverage counts primary verb only', () => {
    const rows = [
      {
        row_id: 1,
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: {
          commands: [{ command: 'git stash' }, { command: 'git rebase' }],
        },
        risk: 0.1,
      },
    ];
    const cov = buildVerbCoverage(rows, { k: 24 });
    expect(cov['git stash'].count).toBe(1);
    expect(cov['git rebase']).toBeUndefined();
  });

  it('weakestAxis prefers State then Flag then Composition on ties', () => {
    expect(weakestAxis({ state: 0.2, flag: 0.2, composition: 0.2 })).toBe('state');
    expect(weakestAxis({ state: 0.9, flag: 0.2, composition: 0.2 })).toBe('flag');
    expect(weakestAxis({ state: 0.9, flag: 0.9, composition: 0.1 })).toBe('composition');
  });

  it('assignMutationKind skips composition when parent is full', () => {
    const row = {
      row_id: 1,
      initial_state: 'x',
      command_recipe: {
        commands: Array.from({ length: 7 }, () => ({ command: 'git status' })),
      },
      risk: 0,
    };
    const cov = buildVerbCoverage([row]);
    expect(assignMutationKind(row, cov)).not.toBe('composition');
  });

  it('sameStepVerbs detects verb freeze', () => {
    const a = { command_recipe: { commands: [{ command: 'git status -s' }] } };
    const b = { command_recipe: { commands: [{ command: 'git status --short' }] } };
    const c = { command_recipe: { commands: [{ command: 'git log' }] } };
    expect(sameStepVerbs(a, b)).toBe(true);
    expect(sameStepVerbs(a, c)).toBe(false);
  });

  it('allVerbsSaturated requires every taxonomy verb', () => {
    expect(allVerbsSaturated({ 'git status': { saturated: true } }, ['git status', 'git log'])).toBe(
      false,
    );
    expect(
      allVerbsSaturated(
        { 'git status': { saturated: true }, 'git log': { saturated: true } },
        ['git status', 'git log'],
      ),
    ).toBe(true);
  });

  it('exports K=24', () => {
    expect(K).toBe(24);
  });
});
