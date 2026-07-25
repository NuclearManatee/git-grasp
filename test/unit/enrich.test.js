import { describe, it, expect } from 'vitest';
import {
  enrichCommandsFromGolden,
  enrichCommandsFromEssentials,
  commandsMissingIntents,
  ESSENTIAL_COMMANDS,
  injectGoldenIntentRows,
} from '../../packages/core/src/catalog/enrich.js';
import { normalizeExample } from '../../packages/core/src/lib/validator.js';

describe('enrich catalog', () => {
  it('happy: merges golden expected examples', () => {
    const out = enrichCommandsFromGolden(
      [{ command: 'git status', example: 'git status', topic: 'status' }],
      [{
        id: 'x',
        expectedCommand: 'git reset',
        expectedExample: 'git reset --soft HEAD~1',
        acceptableCommands: ['git reset'],
        acceptableExamples: ['git reset --soft HEAD~1'],
      }],
    );
    expect(out.some((c) => c.example === 'git reset --soft HEAD~1')).toBe(true);
    expect(out.some((c) => normalizeExample(c.example) === 'git status')).toBe(true);
  });

  it('positive: essentials include soft reset example', () => {
    const out = enrichCommandsFromEssentials([]);
    expect(out.length).toBeGreaterThan(ESSENTIAL_COMMANDS.length);
    expect(out.some((c) => c.example === 'git stash pop')).toBe(true);
  });

  it('negative: empty golden changes nothing beyond input', () => {
    const base = [{ command: 'git status', example: 'git status', topic: 'status' }];
    expect(enrichCommandsFromGolden(base, []).map((c) => c.example)).toEqual(['git status']);
  });

  it('edge: missing intents detects gaps by example', () => {
    const commands = [
      { command: 'git a', example: 'git a' },
      { command: 'git b', example: 'git b' },
    ];
    const intents = [{ command: 'git a', example: 'git a' }];
    expect(commandsMissingIntents(commands, intents).map((c) => c.example)).toEqual(['git b']);
  });

  it('fault: tolerates nullish inputs', () => {
    expect(enrichCommandsFromGolden(null, null)).toEqual([]);
    expect(commandsMissingIntents(null, null)).toEqual([]);
  });

  it('injects golden queries as intents', () => {
    const rows = injectGoldenIntentRows([], [{
      id: 'stash-01',
      query: 'stash my uncommitted work',
      expectedCommand: 'git stash',
      expectedExample: 'git stash',
      expectedSkillBand: [1, 3],
    }]);
    expect(rows[0].example).toBe('git stash');
    expect(rows[0].intent_description).toBe('stash my uncommitted work');
  });
});
