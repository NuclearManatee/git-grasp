import { describe, expect, it } from 'bun:test';
import {
  MUTATION_KINDS,
  STATE_BUCKETS,
  verbFromCommandLine,
  verbsInRecipe,
  flagsFromCommandLine,
  flagFingerprintForVerb,
  parseFlagsFromHelp,
  stateBucket,
  weakestAxis,
  buildVerbCoverage,
  allVerbsSaturated,
  leafPriorityScore,
  assignMutationKind,
  flagsAllowedOnCommand,
  stepVerbs,
  sameStepVerbs,
} from '../../../common/src/build/coverage.ts';

function recipe(commands: string[]) {
  return {
    command_recipe: JSON.stringify({
      commands: commands.map((command) => ({ command, comment: '' })),
    }),
  };
}

describe('verb/flag parsers', () => {
  it('extracts git verb and flags', () => {
    expect(verbFromCommandLine('git rebase -i HEAD~3')).toBe('git rebase');
    expect(verbFromCommandLine('rebase')).toBe('');
    expect(verbFromCommandLine('')).toBe('');
    expect(flagsFromCommandLine('git rebase --onto=main -i HEAD')).toEqual(['--onto', '-i']);
    expect(flagsFromCommandLine('git status -')).toEqual([]);
  });

  it('collects verbs and fingerprints from recipes', () => {
    const r = recipe(['git add file', 'git commit -m x']);
    expect(verbsInRecipe(r)).toEqual(['git add', 'git commit']);
    expect(verbsInRecipe(r.command_recipe)).toEqual(['git add', 'git commit']);
    expect(flagFingerprintForVerb(r, 'git commit')).toBe('-m');
    expect(flagFingerprintForVerb(r, 'git status')).toBe('');
    expect(stepVerbs(r)).toEqual(['git add', 'git commit']);
    expect(sameStepVerbs(r, r)).toBe(true);
    expect(sameStepVerbs(r, recipe(['git add file']))).toBe(false);
    expect(sameStepVerbs(r, recipe(['git add file', 'git status']))).toBe(false);
  });

  it('parses help flags including [no-] polarities', () => {
    const flags = parseFlagsFromHelp('Usage: git foo --[no-]ff -q --quiet');
    expect(flags.has('--ff')).toBe(true);
    expect(flags.has('--no-ff')).toBe(true);
    expect(flags.has('--quiet')).toBe(true);
    expect(flags.has('-q')).toBe(true);
    expect(parseFlagsFromHelp('').size).toBe(0);
  });
});

describe('stateBucket', () => {
  it('classifies initial states', () => {
    expect(stateBucket('detached HEAD at abcdef0')).toBe('detached_or_diverged');
    expect(stateBucket('git remote add origin url')).toBe('with_remote');
    expect(stateBucket('echo hi > file && git add file')).toBe('dirty_worktree');
    expect(stateBucket('touch readme')).toBe('dirty_worktree');
    expect(stateBucket('git commit --allow-empty -m x')).toBe('minimal');
    expect(STATE_BUCKETS).toContain('minimal');
  });
});

describe('weakestAxis + mutation', () => {
  it('picks the lowest axis and honors compositionExhausted', () => {
    expect(MUTATION_KINDS).toEqual(['state', 'flag', 'composition']);
    expect(weakestAxis({ state: 0.1, flag: 0.9, composition: 0.9 })).toBe('state');
    expect(weakestAxis({ state: 1, flag: 1, composition: 0.1 }, { compositionExhausted: true })).toBe(
      'state',
    );
  });

  it('assigns mutation kind from coverage', () => {
    expect(assignMutationKind(recipe([]), {})).toBe('composition');
    const long = recipe(Array.from({ length: 7 }, () => 'git status'));
    expect(assignMutationKind(long, {})).toBe('state');
    const cov = {
      'git status': { progress: { state: 0.2, flag: 0.9, composition: 0.9 }, weakestAxis: 'state' },
    };
    expect(assignMutationKind(recipe(['git status']), cov)).toBe('state');
  });
});

describe('buildVerbCoverage', () => {
  it('aggregates rows and reports saturation', () => {
    const rows = [
      {
        row_id: 1,
        initial_state: 'clean',
        ...recipe(['git status']),
      },
      {
        row_id: 2,
        initial_state: 'echo x > f && git add f',
        ...recipe(['git status --short']),
      },
      {
        row_id: 3,
        initial_state: 'git remote add origin url',
        ...recipe(['git status', 'git add f', 'git commit -m x', 'git push']),
      },
    ];
    const coverage = buildVerbCoverage(rows, { k: 3 });
    expect(coverage['git status'].count).toBe(3);
    expect(coverage['git status'].progress.count).toBeGreaterThan(0);
    expect(allVerbsSaturated(coverage, [])).toBe(false);
    expect(allVerbsSaturated(coverage, ['git status'])).toBe(false);
    expect(allVerbsSaturated({}, ['git missing'])).toBe(false);
    expect(leafPriorityScore(recipe(['git status']), coverage)).toBe(
      coverage['git status'].saturationScore,
    );
    expect(leafPriorityScore(recipe([]), coverage)).toBe(0);
    expect(leafPriorityScore(recipe(['git never']), coverage)).toBe(0);
  });

  it('skips rows without a git verb', () => {
    expect(buildVerbCoverage([{ row_id: 1, initial_state: '', command_recipe: '[]' }])).toEqual({});
  });
});

describe('flagsAllowedOnCommand', () => {
  it('allows empty allowlist and checks membership', () => {
    expect(flagsAllowedOnCommand('git status --short', [])).toBe(true);
    expect(flagsAllowedOnCommand('git status --short', ['--short'])).toBe(true);
    expect(flagsAllowedOnCommand('git status --short', new Set(['--porcelain']))).toBe(false);
  });
});
