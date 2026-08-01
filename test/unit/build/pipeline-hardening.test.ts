import { describe, it, expect } from 'vitest';
import { filterIntentsForRecipe, primaryStepListing } from '../../../common/src/build/intentFidelity.ts';
import { recipeFingerprint, dedupDecision } from '../../../common/src/build/dedup.ts';
import { assertFlagMutation } from '../../../common/src/build/evolveGuards.ts';

describe('intentFidelity', () => {
  it('lists primary step only', () => {
    const { primary, listing } = primaryStepListing({
      command_recipe: {
        commands: [
          { command: 'git config user.name Ada', comment: 'set name' },
          { command: 'git status', comment: 'noise' },
        ],
      },
    });
    expect(primary).toContain('git config');
    expect(listing).not.toContain('git status');
  });

  it('drops command-like and cross-verb traps', () => {
    const recipe = {
      command_recipe: { commands: [{ command: 'git config user.name x' }] },
    };
    const out = filterIntentsForRecipe(recipe, [
      { intent_text: 'git config user.name', skill_level: 'beginner', intent_category: 'goal' },
      { intent_text: 'who wrote this line', skill_level: 'beginner', intent_category: 'goal' },
      { intent_text: 'change my git username', skill_level: 'beginner', intent_category: 'goal' },
    ]);
    expect(out.map((i) => i.intent_text)).toEqual(['change my git username']);
  });

  it('respects custom cap (batch default 8)', () => {
    const recipe = {
      command_recipe: { commands: [{ command: 'git status' }] },
    };
    const many = Array.from({ length: 10 }, (_, i) => ({
      skill_level: 'beginner',
      intent_category: 'goal',
      intent_text: `show my repo status please number ${i}`,
    }));
    expect(filterIntentsForRecipe(recipe, many)).toHaveLength(8);
    expect(filterIntentsForRecipe(recipe, many, { cap: 3 })).toHaveLength(3);
    expect(filterIntentsForRecipe(recipe, many, { cap: 32 })).toHaveLength(10);
  });
});

describe('recipeFingerprint', () => {
  it('ignores volatile paths for same flags', () => {
    const a = recipeFingerprint({
      commands: [{ command: 'git blame f.txt' }],
    });
    const b = recipeFingerprint({
      commands: [{ command: 'git blame other.txt' }],
    });
    expect(a).toBe(b);
  });

  it('dedupDecision keeps simpler', () => {
    const existing = { command_recipe: { commands: [{ command: 'git status -s -b' }] } };
    const candidate = { command_recipe: { commands: [{ command: 'git status -s' }] } };
    expect(dedupDecision(existing, candidate)).toBe('replace_existing');
  });
});

describe('assertFlagMutation', () => {
  it('fails closed on empty allowlist', () => {
    const parent = { command_recipe: { commands: [{ command: 'git status' }] }, initial_state: 'x' };
    const child = { command_recipe: { commands: [{ command: 'git status -s' }] }, initial_state: 'x' };
    const r = assertFlagMutation(parent, child, { 'git status': new Set() });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/allowlist_empty/);
  });

  it('allows single flag add from allowlist', () => {
    const parent = { command_recipe: { commands: [{ command: 'git status' }] }, initial_state: 'x' };
    const child = { command_recipe: { commands: [{ command: 'git status -s' }] }, initial_state: 'x' };
    const r = assertFlagMutation(parent, child, { 'git status': new Set(['-s']) });
    expect(r.ok).toBe(true);
  });
});
