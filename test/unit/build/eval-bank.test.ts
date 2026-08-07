import { describe, it, expect } from 'vitest';
import {
  tagGolden,
  primaryVerbFromRecipe,
  stepVerbsFromRecipe,
  goldenQueryAcceptable,
  normalizeQueryText,
  fallbackGoldenQuery,
  generateGoldenQuery,
} from '../../../common/src/build/evalGate.ts';

describe('eval bank tagging', () => {
  it('tagGolden adds mutation_kind and primary_verb', () => {
    const g = tagGolden(
      { query_text: 'show status', command_id: 7, kind: 'golden' },
      { mutation_kind: 'flag', primary_verb: 'git status' },
    );
    expect(g.mutation_kind).toBe('flag');
    expect(g.primary_verb).toBe('git status');
    expect(g.command_id).toBe(7);
  });

  it('tagGolden defaults ground', () => {
    const g = tagGolden(
      { query_text: 'x', command_id: 1, kind: 'golden' },
      { mutation_kind: 'ground' },
    );
    expect(g.mutation_kind).toBe('ground');
  });

  it('primaryVerbFromRecipe reads first step', () => {
    expect(
      primaryVerbFromRecipe({
        command_recipe: { commands: [{ command: 'git rebase -i' }] },
      }),
    ).toBe('git rebase');
  });

  it('primaryVerbFromRecipe parses JSON string recipes from sqlite', () => {
    expect(
      primaryVerbFromRecipe({
        command_recipe: JSON.stringify({
          commands: [{ command: 'git status --short' }],
        }),
      }),
    ).toBe('git status');
  });

  it('stepVerbsFromRecipe returns all step verbs', () => {
    expect(
      stepVerbsFromRecipe({
        command_recipe: {
          commands: [
            { command: 'git stash push' },
            { command: 'git pull --rebase' },
            { command: 'git stash pop' },
          ],
        },
      }),
    ).toEqual(['git stash', 'git pull']);
  });
});

describe('golden query fidelity', () => {
  it('rejects missing verb token and generic pickaxe template', () => {
    expect(
      goldenQueryAcceptable(
        'How can I find the commit that introduced a specific string?',
        'git status',
      ).ok,
    ).toBe(false);
    expect(goldenQueryAcceptable('show working tree status', 'git status').ok).toBe(true);
  });

  it('accepts any step verb when given a verb list', () => {
    expect(
      goldenQueryAcceptable('how do I pull latest with rebase', [
        'git stash',
        'git pull',
      ]).ok,
    ).toBe(true);
    expect(
      goldenQueryAcceptable('save my uncommitted work before updating', [
        'git stash',
        'git pull',
      ]).reason,
    ).toBe('missing_verb_token');
  });

  it('rejects near-dups against prior bank', () => {
    const prior = [normalizeQueryText('how do i rebase onto main branch safely')];
    expect(
      goldenQueryAcceptable(
        'How do I rebase onto main branch safely please?',
        'git rebase',
        prior,
      ).reason,
    ).toBe('near_dup');
  });

  it('fallbackGoldenQuery mentions the verb', () => {
    const f = fallbackGoldenQuery('git stash push -u', 9);
    expect(f.query_text).toMatch(/stash/i);
    expect(f.command_id).toBe(9);
  });

  it('generateGoldenQuery parses string command_recipe (sqlite shape)', async () => {
    const seen = [];
    const g = await generateGoldenQuery(
      {
        initial_state: 'git commit --allow-empty -m init\n',
        mutation_kind: 'flag',
        title: 'Remove untracked files from the worktree',
        command_recipe: JSON.stringify({
          commands: [{ command: 'git clean -fd', comment: 'remove untracked' }],
        }),
      },
      42,
      {
        maxAttempts: 1,
        llmJsonObject: async ({ messages }) => {
          seen.push(messages[1].content);
          return { query_text: 'how do I clean untracked files' };
        },
      },
    );
    expect(seen[0]).toMatch(/git clean/);
    expect(seen[0]).toMatch(/Mutation kind: flag/);
    expect(seen[0]).toMatch(/Initial state:/);
    expect(seen[0]).toMatch(/Remove untracked files/);
    expect(g.query_text).toMatch(/clean/i);
    expect(g.command_id).toBe(42);
  });

  it('composition golden accepts secondary-step verb without LLM fidelity', async () => {
    const calls = [];
    const g = await generateGoldenQuery(
      {
        title: 'Update branch without losing uncommitted work',
        initial_state: 'echo x > f.txt\ngit add f.txt\n',
        mutation_kind: 'composition',
        command_recipe: {
          commands: [
            { command: 'git stash push -u' },
            { command: 'git pull --rebase' },
            { command: 'git stash pop' },
          ],
        },
      },
      7,
      {
        maxAttempts: 1,
        llmJsonObject: async () => {
          calls.push(1);
          return { query_text: 'how do I pull latest changes after stashing' };
        },
      },
    );
    expect(g.query_text).toMatch(/pull/i);
    expect(g.fidelity).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('composition verb-less golden passes via LLM fidelity and is tagged', async () => {
    let n = 0;
    const g = await generateGoldenQuery(
      {
        title: 'Update branch without losing uncommitted work',
        initial_state: 'echo x > f.txt\ngit add f.txt\n',
        mutation_kind: 'composition',
        command_recipe: {
          commands: [
            { command: 'git stash push -u' },
            { command: 'git pull --rebase' },
            { command: 'git stash pop' },
          ],
        },
      },
      8,
      {
        maxAttempts: 1,
        llmJsonObject: async () => {
          n += 1;
          if (n === 1) {
            return {
              query_text: 'update my branch from remote without losing local edits',
            };
          }
          return { ok: true };
        },
      },
    );
    expect(g.query_text).toMatch(/without losing/i);
    expect(g.fidelity).toBe('llm');
    expect(n).toBe(2);
  });

  it('composition verb-less golden falls back when fidelity rejects', async () => {
    let n = 0;
    const g = await generateGoldenQuery(
      {
        title: 'Update branch without losing uncommitted work',
        initial_state: 'echo x > f.txt\n',
        mutation_kind: 'composition',
        command_recipe: {
          commands: [
            { command: 'git stash push -u' },
            { command: 'git pull --rebase' },
          ],
        },
      },
      9,
      {
        maxAttempts: 1,
        llmJsonObject: async () => {
          n += 1;
          if (n === 1) return { query_text: 'update my branch from remote safely' };
          return { ok: false };
        },
      },
    );
    expect(g.fallback || g.report_only || /how do I use git/i.test(g.query_text)).toBeTruthy();
    expect(g.fidelity).toBeUndefined();
  });

  it('ground behavior still requires primary verb token', async () => {
    const g = await generateGoldenQuery(
      {
        title: 'Show working tree status',
        initial_state: 'git commit --allow-empty -m init\n',
        mutation_kind: 'ground',
        command_recipe: { commands: [{ command: 'git status' }] },
      },
      10,
      {
        maxAttempts: 1,
        llmJsonObject: async () => ({
          query_text: 'what files did I change in this repo',
        }),
      },
    );
    expect(g.query_text).toMatch(/how do I use git status/i);
  });

  it('user-simulator golden prompt omits recipe steps and primary command', async () => {
    /** @type {object[]} */
    const captured = [];
    await generateGoldenQuery(
      {
        title: 'Update branch without losing uncommitted work',
        initial_state: 'echo x > f.txt\ngit add f.txt\n',
        mutation_kind: 'composition',
        command_recipe: {
          commands: [
            { command: 'git stash push -u' },
            { command: 'git pull --rebase' },
            { command: 'git stash pop' },
          ],
        },
      },
      11,
      {
        maxAttempts: 1,
        llmJsonObject: async ({ messages }) => {
          captured.push(messages);
          return {
            query_text: 'update my branch from remote without losing local edits',
          };
        },
      },
    );
    expect(captured).toHaveLength(2); // golden + fidelity
    const userText = (captured[0] || [])
      .filter((m) => m.role === 'user')
      .map((m) => m.content)
      .join('\n');
    expect(userText).toContain('Title:');
    expect(userText).toContain('Initial state:');
    expect(userText).not.toMatch(/Full recipe steps/i);
    expect(userText).not.toMatch(/Primary command:/i);
    expect(userText).not.toContain('git stash push');
  });
});

describe('tagGolden source', () => {
  it('defaults source to llm and accepts explicit source', () => {
    const a = tagGolden(
      { query_text: 'show status', command_id: 1, kind: 'golden' },
      { mutation_kind: 'ground', primary_verb: 'git status' },
    );
    expect(a.source).toBe('llm');
    const b = tagGolden(
      { query_text: 'undo commit', command_id: 2, kind: 'golden' },
      { mutation_kind: 'ground', primary_verb: 'git reset', source: 'telemetry' },
    );
    expect(b.source).toBe('telemetry');
  });
});
