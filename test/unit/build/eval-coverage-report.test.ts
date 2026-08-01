import { describe, it, expect } from 'vitest';
import { buildCoveragePromoteReport } from '../../../packages/core/src/build/evalGate.ts';
import {
  EVAL_COVERAGE_WARN_FRACTION,
  EVAL_COVERAGE_WARN_VERB_MIN,
} from '../../../packages/core/src/db/constants.ts';

describe('coverage promote report', () => {
  it('warns when fewer than 80% verbs have >= 3 recipes', () => {
    const rows = [
      {
        row_id: 1,
        initial_state: 'x',
        command_recipe: { commands: [{ command: 'git status' }] },
      },
      {
        row_id: 2,
        initial_state: 'x',
        command_recipe: { commands: [{ command: 'git status' }] },
      },
      {
        row_id: 3,
        initial_state: 'x',
        command_recipe: { commands: [{ command: 'git status' }] },
      },
      {
        row_id: 4,
        initial_state: 'x',
        command_recipe: { commands: [{ command: 'git log' }] },
      },
    ];
    const taxonomy = ['git status', 'git log', 'git rebase', 'git push', 'git pull'];
    const report = buildCoveragePromoteReport(rows, taxonomy, {
      minRecipes: EVAL_COVERAGE_WARN_VERB_MIN,
      warnFraction: EVAL_COVERAGE_WARN_FRACTION,
    });
    // only status has 3; 1/5 = 0.2 < 0.8
    expect(report.fractionWithMinRecipes).toBeCloseTo(0.2);
    expect(report.warn).toBe(true);
    expect(report.sparseVerbs).toContain('git log');
    expect(report.sparseVerbs).toContain('git rebase');
  });

  it('does not warn when enough verbs meet the floor', () => {
    const rows = [];
    let id = 1;
    for (const verb of ['git status', 'git log', 'git rebase', 'git push']) {
      for (let i = 0; i < 3; i += 1) {
        rows.push({
          row_id: id++,
          initial_state: 'x',
          command_recipe: { commands: [{ command: verb }] },
        });
      }
    }
    const taxonomy = ['git status', 'git log', 'git rebase', 'git push'];
    const report = buildCoveragePromoteReport(rows, taxonomy);
    expect(report.fractionWithMinRecipes).toBe(1);
    expect(report.warn).toBe(false);
    expect(report.sparseVerbs).toHaveLength(0);
  });
});
