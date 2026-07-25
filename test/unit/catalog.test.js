import { describe, it, expect } from 'vitest';
import { stripHtmlToText, assertAllowlistedUrl } from '../../src/catalog/docs.js';
import { mergeCommands } from '../../src/catalog/step1Commands.js';
import { normalizeCommands, normalizeIntents, subcommandsFromCommands } from '../../src/catalog/step3Normalize.js';
import { generateIntentsForCommand } from '../../src/catalog/step2Intents.js';

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
  it('dedupes by command string', () => {
    const m = mergeCommands(
      [{ command: 'git status', topic: 'status', risk_class: 'none' }],
      [{ command: 'git status', topic: 'status', risk_class: 'low' }, { command: 'git add .', topic: 'stage', risk_class: 'low' }],
    );
    expect(m).toHaveLength(2);
  });
});

describe('normalize', () => {
  it('drops shell metacharacters', () => {
    const { commands, drops } = normalizeCommands([
      { command: 'git status', topic: 'status', risk_class: 'none' },
      { command: 'git status && rm -rf /', topic: 'status', risk_class: 'destructive' },
    ]);
    expect(commands.map((c) => c.command)).toEqual(['git status']);
    expect(drops.some((d) => d.reason === 'shell_meta')).toBe(true);
  });

  it('builds allowlist from commands', () => {
    const list = subcommandsFromCommands([{ command: 'git switch -c <name>' }]);
    expect(list).toContain('switch');
  });

  it('normalizes intents and assigns ids', () => {
    const { intents, drops } = normalizeIntents([
      {
        command: 'git status',
        skill_level: 1,
        intent_description: 'what changed',
        explanation: 'x',
        risks: '',
        examples: 'git status',
        risk_class: 'none',
      },
    ]);
    expect(drops).toHaveLength(0);
    expect(intents[0].id).toBe('git-status:1');
  });
});

describe('generateIntentsForCommand', () => {
  it('maps llm json to rows (single command, no batch)', async () => {
    const rows = await generateIntentsForCommand(
      { command: 'git stash', topic: 'stash', risk_class: 'low' },
      {
        schedule: async (fn) => fn(),
        groqJson: async () => ({
          command: 'git stash',
          risk_class: 'low',
          explanation: 'stash changes',
          risks: 'may conflict',
          examples: 'git stash',
          intents: [
            { skill_level: 1, intent_description: 'shelve my work' },
            { skill_level: 5, intent_description: 'git stash' },
          ],
        }),
      },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe('git-stash:1');
  });
});
