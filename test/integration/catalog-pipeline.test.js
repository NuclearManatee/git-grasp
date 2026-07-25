import { describe, it, expect } from 'vitest';
import { extractCommandsWithAreYouSure, mergeCommands } from '../../src/catalog/step1Commands.js';

describe('extractCommandsWithAreYouSure (mocked Groq)', () => {
  it('extracts then completes Are You Sure loop', async () => {
    let calls = 0;
    const groqJson = async ({ messages }) => {
      calls += 1;
      const sys = messages[0].content;
      if (sys.includes('EXTRACTOR')) {
        return {
          commands: [
            { command: 'git init', topic: 'create', risk_class: 'low' },
            { command: 'git status', topic: 'status', risk_class: 'none' },
          ],
        };
      }
      // Are you sure — first round add many, second sure
      if (calls < 5) {
        return {
          sure: false,
          additional_commands: Array.from({ length: 50 }, (_, i) => ({
            command: `git log --oneline ${i}`,
            topic: 'history',
            risk_class: 'none',
          })),
          rationale: 'need more',
        };
      }
      return { sure: true, additional_commands: [], rationale: 'complete enough for mock', missing_topics: [] };
    };

    // Provide enough synthetic pages to get volume via AYS
    const pages = [{ url: 'https://git-scm.com/docs/git-status', text: 'git status shows the working tree' }];

    // Force minCommands low for unit test speed
    const result = await extractCommandsWithAreYouSure({
      pages,
      groqJson,
      schedule: async (fn) => fn(),
      maxRounds: 3,
      minCommands: 10,
    });

    expect(result.commands.length).toBeGreaterThanOrEqual(10);
    expect(result.rounds.length).toBeGreaterThan(0);
    expect(mergeCommands(result.commands, []).length).toBe(result.commands.length);
  });
});
