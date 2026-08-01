import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGroundStep } from '../../packages/core/src/build/orchestrator.js';
import { openDb, countCommands, countIntents, insertCommand } from '../../packages/core/src/db/schema.js';
import { validateInSandboxAndDestroy } from '../../packages/core/src/build/sandbox.js';
import { selectEvolutionParents } from '../../packages/core/src/build/loop.js';
import { loadBank } from '../../packages/core/src/build/evalGate.js';

describe('ground + loop helpers (mocked)', () => {
  let evalDir;
  let prevEvalDir;

  beforeEach(() => {
    evalDir = mkdtempSync(path.join(tmpdir(), 'gh-ground-eval-'));
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

  it('ground step inserts validated recipe with intents', async () => {
    process.env.GIT_GRASP_MOCK_EMBEDDINGS = '1';
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-ground-'));
    const stagingPath = path.join(dir, 'staging.db');
    mkdirSync(path.join(dir, 'eval'), { recursive: true });

    const result = await runGroundStep({
      stagingPath,
      fresh: true,
      mock: true,
      skipEval: true,
      skipEvalBanks: true,
      concurrency: 2,
      groups: [
        {
          command: 'git status',
          blocks: [
            {
              metadata_source: 'fixture.md',
              content: 'Show status.\n\n```\ngit status\n```',
            },
          ],
        },
      ],
      generate: async () => ({
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git status', comment: 'check' }] },
        risk: 0.05,
      }),
      validate: (g) => validateInSandboxAndDestroy(g),
      expandIntents: async () => [
        {
          skill_level: 'beginner',
          intent_category: 'goal',
          intent_text: 'show working tree status',
        },
      ],
    });

    expect(result.inserted).toBeGreaterThanOrEqual(1);
    const db = openDb(stagingPath, { readonly: true });
    expect(countCommands(db)).toBeGreaterThanOrEqual(1);
    expect(countIntents(db)).toBeGreaterThanOrEqual(1);
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('ground golden is tagged mutation_kind=ground', async () => {
    process.env.GIT_GRASP_MOCK_EMBEDDINGS = '1';
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-ground-tag-'));
    const stagingPath = path.join(dir, 'staging.db');

    const result = await runGroundStep({
      stagingPath,
      fresh: true,
      mock: true,
      skipEval: false,
      skipEvalBanks: false,
      concurrency: 1,
      minPassRate: 0,
      groups: [
        {
          command: 'git status',
          blocks: [
            {
              metadata_source: 'fixture.md',
              content: 'Show status.\n\n```\ngit status\n```',
            },
          ],
        },
      ],
      generate: async () => ({
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git status', comment: 'check' }] },
        risk: 0.05,
      }),
      validate: (g) => validateInSandboxAndDestroy(g),
      expandIntents: async () => [
        {
          skill_level: 'beginner',
          intent_category: 'goal',
          intent_text: 'show working tree status',
        },
      ],
      generateGolden: async (_row, id) => ({
        query_text: 'show status please',
        command_id: id,
        kind: 'golden',
      }),
      expandQueries: async () => [],
      searchFn: async () => [{ command_id: 1, snippet: 'git status' }],
      llmJsonObject: async () => ({ utility: 0.1, reason: 'no' }),
    });

    expect(result.inserted).toBeGreaterThanOrEqual(1);
    expect(result.eval?.ok).toBe(true);
    const bank = loadBank('golden.jsonl');
    expect(bank.length).toBeGreaterThanOrEqual(1);
    expect(bank[0].mutation_kind).toBe('ground');
    expect(bank[0].primary_verb).toBe('git status');
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('selectEvolutionParents prefers leaves', () => {
    const db = openDb(':memory:');
    const p = insertCommand(db, {
      initial_state: 'a',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'i1',
      final_state_physical_hash: 'f1',
      risk: 0.1,
    });
    insertCommand(db, {
      initial_state: 'b',
      command_recipe: { commands: [{ command: 'git log' }] },
      initial_state_physical_hash: 'i2',
      final_state_physical_hash: 'f2',
      risk: 0.9,
      parent_row_id: p,
    });
    const parents = selectEvolutionParents(db, 10);
    expect(parents.some((r) => r.row_id !== p || parents.length === 1)).toBe(true);
    db.close();
  });
});
