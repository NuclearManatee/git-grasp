import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildCoveragePromoteReport,
  writeCoveragePromoteReport,
} from '../../common/src/build/evalGate.js';
import {
  EVAL_COVERAGE_WARN_FRACTION,
  EVAL_COVERAGE_WARN_VERB_MIN,
} from '../../common/src/db/constants.js';

function recipeRows(verbCounts) {
  const rows = [];
  let id = 1;
  for (const [verb, n] of Object.entries(verbCounts)) {
    for (let i = 0; i < n; i += 1) {
      rows.push({
        row_id: id++,
        initial_state: 'x',
        command_recipe: { commands: [{ command: verb }] },
      });
    }
  }
  return rows;
}

describe('eval coverage promote', () => {
  let evalDir;
  let prevEvalDir;

  beforeEach(() => {
    evalDir = mkdtempSync(path.join(tmpdir(), 'gh-cov-'));
    prevEvalDir = process.env.GIT_GRASP_EVAL_DIR;
    process.env.GIT_GRASP_EVAL_DIR = evalDir;
  });

  afterEach(() => {
    if (prevEvalDir === undefined) delete process.env.GIT_GRASP_EVAL_DIR;
    else process.env.GIT_GRASP_EVAL_DIR = prevEvalDir;
    try {
      rmSync(evalDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('warns below 80% taxonomy verbs with >= 3 recipes', () => {
    const taxonomy = ['git status', 'git log', 'git rebase', 'git push', 'git pull'];
    const rows = recipeRows({ 'git status': 3, 'git log': 1 });
    const report = buildCoveragePromoteReport(rows, taxonomy, {
      minRecipes: EVAL_COVERAGE_WARN_VERB_MIN,
      warnFraction: EVAL_COVERAGE_WARN_FRACTION,
    });
    expect(report.warn).toBe(true);
    expect(report.fractionWithMinRecipes).toBeCloseTo(0.2);
    const p = writeCoveragePromoteReport(report);
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    expect(parsed.warn).toBe(true);
  });

  it('does not warn when coverage meets floor', () => {
    const taxonomy = ['git status', 'git log', 'git rebase', 'git push'];
    const rows = recipeRows({
      'git status': 3,
      'git log': 3,
      'git rebase': 3,
      'git push': 3,
    });
    const report = buildCoveragePromoteReport(rows, taxonomy);
    expect(report.warn).toBe(false);
    expect(report.sparseVerbs).toHaveLength(0);
  });
});
