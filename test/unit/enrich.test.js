import { describe, it, expect } from 'vitest';
import {
  enrichCommandsFromGolden,
  enrichCommandsFromEssentials,
  commandsMissingIntents,
  ESSENTIAL_COMMANDS,
} from '../../src/catalog/enrich.js';

describe('enrich catalog', () => {
  it('happy: merges golden expected commands', () => {
    const out = enrichCommandsFromGolden(
      [{ command: 'git status', topic: 'status', risk_class: 'none' }],
      [{ id: 'x', expectedCommand: 'git reset --soft HEAD~1', acceptableCommands: ['git reset --soft HEAD~1'] }],
    );
    expect(out.some((c) => c.command === 'git reset --soft HEAD~1')).toBe(true);
    expect(out.some((c) => c.command === 'git status')).toBe(true);
  });

  it('positive: essentials include soft reset', () => {
    const out = enrichCommandsFromEssentials([]);
    expect(out.length).toBe(ESSENTIAL_COMMANDS.length);
    expect(out.some((c) => c.command === 'git stash pop')).toBe(true);
  });

  it('negative: empty golden changes nothing beyond input', () => {
    const base = [{ command: 'git status', topic: 'status', risk_class: 'none' }];
    expect(enrichCommandsFromGolden(base, []).map((c) => c.command)).toEqual(['git status']);
  });

  it('edge: missing intents detects gaps', () => {
    const commands = [{ command: 'a' }, { command: 'b' }];
    const intents = [{ command: 'a' }];
    expect(commandsMissingIntents(commands, intents).map((c) => c.command)).toEqual(['b']);
  });

  it('fault: tolerates nullish inputs', () => {
    expect(enrichCommandsFromGolden(null, null)).toEqual([]);
    expect(commandsMissingIntents(null, null)).toEqual([]);
  });

  it('injects golden queries as intents', async () => {
    const { injectGoldenIntentRows } = await import('../../src/catalog/enrich.js');
    const rows = injectGoldenIntentRows([], [{
      id: 'stash-01',
      query: 'stash my uncommitted work',
      expectedCommand: 'git stash',
      expectedSkillBand: [1, 3],
    }]);
    expect(rows[0].command).toBe('git stash');
    expect(rows[0].intent_description).toBe('stash my uncommitted work');
  });
});
