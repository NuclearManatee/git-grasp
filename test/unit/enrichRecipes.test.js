import { describe, it, expect } from 'vitest';
import { enrichRecipesFromGolden } from '../../packages/core/src/catalog/enrichRecipes.js';
import { deriveCommandKey } from '../../packages/core/src/catalog/stepRecipes.js';

describe('enrichRecipesFromGolden', () => {
  it('derives command from each example, not parent expectedCommand', () => {
    const out = enrichRecipesFromGolden([], [{
      id: 'branch-current-01',
      expectedCommand: 'git branch',
      expectedExample: 'git branch --show-current',
      acceptableExamples: [
        'git symbolic-ref --short HEAD',
        'git rev-parse --abbrev-ref HEAD',
      ],
    }]);
    const sym = out.find((r) => r.primary_example === 'git symbolic-ref --short HEAD');
    const rev = out.find((r) => r.primary_example === 'git rev-parse --abbrev-ref HEAD');
    expect(sym.command).toBe(deriveCommandKey('git symbolic-ref --short HEAD'));
    expect(rev.command).toBe(deriveCommandKey('git rev-parse --abbrev-ref HEAD'));
    expect(sym.command).toBe('git symbolic-ref');
    expect(rev.command).toBe('git rev-parse');
  });
});
