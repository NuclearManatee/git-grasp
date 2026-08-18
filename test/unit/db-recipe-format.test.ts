import { describe, expect, it } from 'bun:test';
import {
  serializeCommands,
  parseCommands,
  renderSnippet,
  serializeCommandRecipe,
  primaryCommand,
} from '../../common/src/db/recipeFormat.ts';

describe('recipeFormat', () => {
  it('serializes and parses command lists', () => {
    expect(serializeCommands('already')).toBe('already');
    expect(serializeCommands({ commands: [{ command: 'git status' }] })).toContain('git status');
    expect(JSON.parse(serializeCommands([{ command: 'git status' }]))).toEqual([
      { command: 'git status' },
    ]);
    expect(parseCommands('not-json')).toEqual([]);
    expect(parseCommands({ commands: [{ run: 'git status', comment: 'ok' }] })).toEqual([
      { command: 'git status', run: 'git status', comment: 'ok' },
    ]);
    expect(parseCommands({ nope: true })).toEqual([]);
    expect(parseCommands([{ command: '  ' }])).toEqual([]);
  });

  it('renders snippets and primary command', () => {
    const steps = [{ command: 'git add f', comment: 'stage' }, { command: 'git commit -m x' }];
    expect(renderSnippet(steps)).toContain('# stage');
    expect(serializeCommandRecipe({ commands: steps })).toContain('git add f');
    expect(serializeCommandRecipe('raw')).toBe('raw');
    expect(primaryCommand({ commands: steps })).toBe('git add f');
    expect(primaryCommand(steps)).toBe('git add f');
  });
});
