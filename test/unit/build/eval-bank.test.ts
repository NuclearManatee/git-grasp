import { describe, it, expect } from 'vitest';
import {
  tagGolden,
  primaryVerbFromRecipe,
  goldenQueryAcceptable,
  normalizeQueryText,
  fallbackGoldenQuery,
  generateGoldenQuery,
} from '../../../packages/core/src/build/evalGate.ts';

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
    expect(g.query_text).toMatch(/clean/i);
    expect(g.command_id).toBe(42);
  });
});
