import { describe, it, expect } from 'bun:test';
import {
  normalizeArgvLine,
  rewriteLiteralsToPlaceholders,
  needsPlaceholderRewrite,
  structuralCommandFingerprint,
  structuralRecipeKey,
} from '../../../common/src/build/argvNormalize.ts';
import { mergeRecipesByStructuralFingerprint } from '../../../common/src/build/mergeRecipes.ts';
import { recipeFingerprint } from '../../../common/src/search/fusion.ts';

describe('argvNormalize', () => {
  it('collapses generic checkout placeholders to <branch>', () => {
    expect(normalizeArgvLine('git checkout <name>')).toBe(
      normalizeArgvLine('git checkout <branch>'),
    );
    expect(
      structuralCommandFingerprint([{ command: 'git checkout <name>' }]),
    ).toBe(
      structuralCommandFingerprint([{ command: 'git checkout <branch>' }]),
    );
  });

  it('collapses email placeholder and demo literal to same structure', () => {
    const a = 'git config user.email "<email>"';
    const b = 'git config user.email "you@example.com"';
    expect(normalizeArgvLine(a)).toBe(normalizeArgvLine(b));
    expect(
      structuralCommandFingerprint([{ command: a }]),
    ).toBe(structuralCommandFingerprint([{ command: b }]));
  });

  it('rewrites demo email to placeholder', () => {
    expect(needsPlaceholderRewrite('git config user.email "you@example.com"')).toBe(
      true,
    );
    expect(rewriteLiteralsToPlaceholders('git config user.email "you@example.com"')).toContain(
      '<email>',
    );
  });

  it('display key matches for literal vs placeholder', () => {
    expect(
      recipeFingerprint({
        commands: [{ command: 'git config user.email "<email>"' }],
      }),
    ).toBe(
      recipeFingerprint({
        commands: [{ command: 'git config user.email "you@example.com"' }],
      }),
    );
  });
});

describe('mergeRecipesByStructuralFingerprint', () => {
  it('merges leaf twins and folds paraphrase', () => {
    const { recipes, removed } = mergeRecipesByStructuralFingerprint(
      [
        {
          id: 'a',
          title: 'Set email',
          description: 'Set local email',
          taxonomy_leaf: 'leaf1',
          commands: [{ command: 'git config user.email "<email>"' }],
          paraphrases: [],
          tags: [],
        },
        {
          id: 'b',
          title: 'Set email demo',
          description: 'Set local email with example.com',
          taxonomy_leaf: 'leaf1',
          commands: [{ command: 'git config user.email "you@example.com"' }],
          paraphrases: ['change my email'],
          tags: [],
        },
      ],
      { scope: 'leaf' },
    );
    expect(removed).toBe(1);
    expect(recipes).toHaveLength(1);
    expect(recipes[0].paraphrases.join(' ')).toMatch(/change my email|example/);
    expect(recipes[0].commands[0].command).toContain('<email>');
  });
});
