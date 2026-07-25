import { describe, it, expect } from 'vitest';
import { extractCommandsWithAreYouSure, mergeCommands } from '../../src/catalog/step1Commands.js';

describe('extractCommandsWithAreYouSure (mocked LLM)', () => {
  it('extracts then completes Are You Sure loop', async () => {
    let phase = 'extract';
    const groqJson = async ({ messages }) => {
      const sys = messages[0].content;
      if (sys.includes('EXTRACTOR') || phase === 'extract') {
        phase = 'ays';
        return {
          commands: [
            {
              command: 'git init',
              examples: [
                { example: 'git init', topic: 'create', risk_class: 'low' },
                { example: 'git init --bare', topic: 'create', risk_class: 'low' },
                { example: 'git init --quiet', topic: 'create', risk_class: 'low' },
              ],
            },
            {
              command: 'git status',
              examples: [
                { example: 'git status', topic: 'status', risk_class: 'none' },
                { example: 'git status -sb', topic: 'status', risk_class: 'none' },
                { example: 'git status --ignored', topic: 'status', risk_class: 'none' },
              ],
            },
          ],
        };
      }
      return {
        sure: false,
        additional_commands: Array.from({ length: 15 }, (_, i) => ({
          command: 'git log',
          examples: [
            { example: `git log --oneline -n ${i + 1}`, topic: 'history', risk_class: 'none' },
            { example: `git log -n ${i + 1}`, topic: 'history', risk_class: 'none' },
            { example: `git log --stat -n ${i + 1}`, topic: 'history', risk_class: 'none' },
          ],
        })),
        rationale: 'need more',
        missing_topics: [],
      };
    };

    const pages = [{ url: 'https://git-scm.com/docs/git-status', text: 'git status shows the working tree' }];

    const result = await extractCommandsWithAreYouSure({
      pages,
      groqJson,
      schedule: async (fn) => fn(),
      maxRounds: 2,
      minCommands: 10,
    });

    expect(result.commands.length).toBeGreaterThanOrEqual(10);
    expect(result.rounds.length).toBeGreaterThan(0);
    expect(result.commands.every((c) => c.example?.startsWith('git '))).toBe(true);
    expect(mergeCommands(result.commands, []).length).toBe(result.commands.length);
  });
});
