import { describe, it, expect } from 'vitest';
import { isCommandLikeIntent, filterCommandLikeIntents } from '../../packages/core/src/catalog/intentHygiene.js';
import { flagHintsFromQuery, preferFlagMatches, preferFewerSteps } from '../../packages/core/src/search/rank.js';

describe('intent hygiene', () => {
  it('flags pasteable git commands', () => {
    expect(isCommandLikeIntent('git add .')).toBe(true);
    expect(isCommandLikeIntent('git pull --rebase')).toBe(true);
    expect(isCommandLikeIntent('pull with rebase instead of merge')).toBe(false);
    expect(isCommandLikeIntent('show ignored files in status')).toBe(false);
  });

  it('filters command-like intents', () => {
    const { intents, dropped } = filterCommandLikeIntents([
      { id: 'a', intent_text: 'git add .' },
      { id: 'b', intent_text: 'stage everything for commit' },
    ]);
    expect(intents).toHaveLength(1);
    expect(intents[0].id).toBe('b');
    expect(dropped).toHaveLength(1);
  });
});

describe('flag-aware ranking', () => {
  it('extracts pull --rebase hint', () => {
    expect(flagHintsFromQuery('pull with rebase instead of merge')).toContain('--rebase');
  });

  it('promotes example with matching flag', () => {
    const scored = [
      { score: 0.9, example: 'git pull', command: 'git pull', commands: [{}] },
      { score: 0.85, example: 'git pull --rebase', command: 'git pull', commands: [{}] },
    ];
    preferFlagMatches(scored, 'pull with rebase instead of merge', 0.2);
    expect(scored[0].example).toBe('git pull --rebase');
  });

  it('prefers single-step for delete branch query', () => {
    const scored = [
      {
        score: 0.9,
        example: 'git switch main',
        command: 'git switch',
        commands: [{}, {}],
      },
      {
        score: 0.84,
        example: 'git branch -d feature/login',
        command: 'git branch',
        commands: [{}],
      },
    ];
    preferFewerSteps(scored, 0.08, 'delete a merged feature branch');
    expect(scored[0].commands).toHaveLength(1);
  });
});
