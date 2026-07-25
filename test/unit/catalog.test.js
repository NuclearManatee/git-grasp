import { describe, it, expect } from 'vitest';
import { stripHtmlToText, assertAllowlistedUrl } from '../../packages/core/src/catalog/docs.js';
import { mergeCommands } from '../../packages/core/src/catalog/step1Commands.js';
import { normalizeCommands, normalizeIntents, subcommandsFromCommands } from '../../packages/core/src/catalog/step3Normalize.js';
import { generateIntentsForCommand } from '../../packages/core/src/catalog/step2Intents.js';

describe('docs helpers', () => {
  it('strips scripts and tags', () => {
    const t = stripHtmlToText('<html><script>x()</script><p>git status</p></html>');
    expect(t).toContain('git status');
    expect(t).not.toContain('x()');
  });

  it('rejects non-allowlisted hosts', () => {
    expect(() => assertAllowlistedUrl('https://evil.com/docs')).toThrow(/allowlisted/);
  });
});

describe('mergeCommands', () => {
  it('dedupes by E4 normalized example', () => {
    const m = mergeCommands(
      [{ command: 'git status', topic: 'status' }],
      [
        { command: 'git status', topic: 'status' },
        { command: 'git add .', topic: 'stage' },
      ],
    );
    expect(m).toHaveLength(2);
    expect(m.map((x) => x.example).sort()).toEqual(['git add .', 'git status']);
  });
});

describe('normalize', () => {
  it('drops shell metacharacters', () => {
    const { commands, drops } = normalizeCommands([
      { command: 'git status', topic: 'status' },
      { command: 'git status && rm -rf /', topic: 'status' },
    ]);
    expect(commands.map((c) => c.example)).toEqual(['git status']);
    expect(drops.some((d) => d.reason === 'shell_meta')).toBe(true);
  });

  it('builds allowlist from commands', () => {
    const list = subcommandsFromCommands([{ command: 'git switch -c feature' }]);
    expect(list).toContain('switch');
  });

  it('normalizes intents and assigns ids', () => {
    const { intents, drops } = normalizeIntents([
      {
        command: 'git status',
        example: 'git status',
        usage: 'git status\nShow status.',
        skill_level: 1,
        intent_description: 'what changed',
        explanation: 'x',
      },
    ]);
    expect(drops).toHaveLength(0);
    expect(intents[0].id).toBe('git-status:1:0');
    expect(intents[0].usage).toMatch(/git status/);
  });
});

describe('generateIntentsForCommand', () => {
  it('maps llm json to rows with usage', async () => {
    const rows = await generateIntentsForCommand(
      { command: 'git stash', example: 'git stash', topic: 'stash' },
      {
        schedule: async (fn) => fn(),
        groqJson: async () => ({
          command: 'git stash',
          example: 'git stash',
          explanation: 'stash changes',
          usage: { command_line: 'git stash', blurb: 'Shelve uncommitted work.' },
          intents: [
            { skill_level: 'non-technical', intent_descriptions: ['shelve my work'] },
            { skill_level: 'expert', intent_descriptions: ['stash working tree'] },
          ],
        }),
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('git-stash:1:0');
    expect(rows[0].usage).toMatch(/Shelve/);
    expect(rows[1].skill_level).toBe(4);
    expect(rows[0].risk_class).toBeUndefined();
  });
});
