import { describe, it, expect } from 'vitest';
import {
  stepSignature,
  mergeRecipesBySignature,
  clipboardTextFromRecipe,
} from '../../packages/core/src/catalog/recipeIdentity.js';
import {
  enrichRecipesFromWorkflows,
  materializeWorkflow,
  workflowCoverageReport,
  WORKFLOW_CHECKLIST,
} from '../../packages/core/src/catalog/stepRecipeWorkflows.js';
import { normalizeRecipes } from '../../packages/core/src/catalog/stepRecipeNormalize.js';
import { preferFewerSteps } from '../../packages/core/src/search/rank.js';
import { gradeCase } from '../../packages/core/src/eval/judge.js';
import { buildRecipeIntentSystem } from '../../packages/core/src/catalog/stepRecipeIntents.js';

describe('recipe identity / step signature', () => {
  it('keeps two recipes that share the first run but differ later', () => {
    const single = {
      id: 'soft-undo-only',
      title: 'Soft undo',
      primary_example: 'git reset --soft HEAD~1',
      command: 'git reset',
      source: 'essential',
      commands: [{ run: 'git reset --soft HEAD~1', comment: '' }],
    };
    const multi = {
      id: 'peel-file-from-last-commit-to-branch',
      title: 'Peel file',
      primary_example: 'git reset --soft HEAD~1',
      command: 'git reset',
      source: 'workflow',
      commands: [
        { run: 'git reset --soft HEAD~1', comment: '' },
        { run: 'git restore --staged app.js', comment: '' },
        { run: 'git commit -m "rest"', comment: '' },
      ],
    };
    expect(stepSignature(single.commands)).not.toBe(stepSignature(multi.commands));
    const merged = mergeRecipesBySignature([single], [multi]);
    expect(merged).toHaveLength(2);
    expect(merged.map((r) => r.id).sort()).toEqual([
      'peel-file-from-last-commit-to-branch',
      'soft-undo-only',
    ].sort());
  });

  it('drops duplicate step signatures preferring workflow over progit', () => {
    const a = {
      id: 'a',
      source: 'progit',
      primary_example: 'git stash',
      commands: [
        { run: 'git stash push -m "wip"' },
        { run: 'git switch main' },
      ],
    };
    const b = {
      id: 'b',
      source: 'workflow',
      primary_example: 'git stash',
      commands: [
        { run: 'git stash push -m "wip"' },
        { run: 'git switch main' },
      ],
    };
    const merged = mergeRecipesBySignature([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('b');
  });

  it('clipboard joins all runs', () => {
    const text = clipboardTextFromRecipe({
      commands: [
        { run: 'git stash' },
        { run: 'git switch main' },
      ],
    });
    expect(text).toBe('git stash\ngit switch main');
  });
});

describe('workflow seed', () => {
  it('loads curated workflows covering checklist', () => {
    const recipes = enrichRecipesFromWorkflows([]);
    expect(recipes.length).toBeGreaterThanOrEqual(30);
    const report = workflowCoverageReport(recipes);
    expect(report.missing).toEqual([]);
    expect(report.multiCount).toBe(recipes.length);
    for (const id of WORKFLOW_CHECKLIST) {
      expect(report.covered).toContain(id);
    }
  });

  it('normalize keeps shared-first-run single and multi', () => {
    const single = {
      id: 'soft-only',
      title: 'Soft',
      source: 'essential',
      commands: [{ run: 'git reset --soft HEAD~1' }],
      primary_example: 'git reset --soft HEAD~1',
      command: 'git reset',
    };
    const multi = materializeWorkflow({
      id: 'peel-x',
      title: 'Peel',
      commands: [
        { run: 'git reset --soft HEAD~1' },
        { run: 'git restore --staged app.js' },
      ],
    });
    const { recipes } = normalizeRecipes([single, multi]);
    expect(recipes.length).toBe(2);
  });
});

describe('preferFewerSteps', () => {
  it('promotes single-step when scores are close', () => {
    const scored = [
      { score: 0.9, commands: [{}, {}, {}], command: 'git reset', example: 'git reset --soft HEAD~1' },
      { score: 0.88, commands: [{}], command: 'git reset', example: 'git reset --soft HEAD~1' },
    ];
    preferFewerSteps(scored, 0.08);
    expect(scored[0].commands).toHaveLength(1);
  });
});

describe('expectedRecipeId judge', () => {
  it('passes when recipe id matches', () => {
    const v = gradeCase(
      { expectedRecipeId: 'peel-file-from-last-commit-to-branch' },
      { recipe_id: 'peel-file-from-last-commit-to-branch', command: 'git reset', example: 'git reset --soft HEAD~1' },
    );
    expect(v.pass).toBe(true);
    expect(v.score).toBe(5);
  });
});

describe('intent system prompt', () => {
  it('mentions multi-step full-outcome rule', () => {
    const sys = buildRecipeIntentSystem({});
    expect(sys).toMatch(/MULTI-STEP/i);
    expect(sys).toMatch(/FULL outcome/i);
  });
});
