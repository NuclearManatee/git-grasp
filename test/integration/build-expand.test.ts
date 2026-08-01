import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runGroundStep, runBuildLoop } from '../../common/src/build/orchestrator.js';
import {
  openDb,
  countCommands,
  countIntents,
  insertCommand,
  insertIntentWithEmbedding,
} from '../../common/src/db/schema.js';
import { validateInSandboxAndDestroy } from '../../common/src/build/sandbox.js';
import { mockEmbed } from '../../common/src/search/embed.js';
import { expandIntentsForRecipe } from '../../common/src/build/intentExpand.js';
import { SKILL_LEVELS, INTENT_CATEGORIES } from '../../common/src/lib/skills.js';
import { makeKnnForeign } from '../../common/src/build/intentSimilarity.js';
import { knnRecall } from '../../common/src/db/schema.js';
import { INTENT_FOREIGN_KNN_K } from '../../common/src/db/constants.js';

function minimalMatrix() {
  const cells = [];
  for (const skill_level of SKILL_LEVELS) {
    for (const intent_category of INTENT_CATEGORIES) {
      cells.push({
        skill_level,
        intent_category,
        description: `${skill_level} ${intent_category}`,
        dos: ['do'],
        donts: ['dont'],
      });
    }
  }
  return { version: 1, generated_at: '2026-01-01T00:00:00.000Z', cells };
}

function allCells() {
  const out = [];
  for (const skill_level of SKILL_LEVELS) {
    for (const intent_category of INTENT_CATEGORIES) {
      out.push({ skill_level, intent_category });
    }
  }
  return out;
}

describe('iterative expand + persist prune (integration)', () => {
  let evalDir;
  let prevEvalDir;

  beforeEach(() => {
    evalDir = mkdtempSync(path.join(tmpdir(), 'gh-expand-eval-'));
    prevEvalDir = process.env.GIT_GRASP_EVAL_DIR;
    process.env.GIT_GRASP_EVAL_DIR = evalDir;
    process.env.GIT_GRASP_MOCK_EMBEDDINGS = '1';
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

  it('real expandIntentsForRecipe fills/skips via llmJsonObject under ground', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-expand-ground-'));
    const stagingPath = path.join(dir, 'staging.db');
    mkdirSync(path.join(dir, 'eval'), { recursive: true });

    const result = await runGroundStep({
      stagingPath,
      fresh: true,
      mock: true,
      skipEval: true,
      skipEvalBanks: true,
      concurrency: 1,
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
      expandIntents: async (recipe) =>
        expandIntentsForRecipe(recipe, {
          matrix: minimalMatrix(),
          embedder: { embed: async (t) => mockEmbed(t) },
          llmJsonObject: async () => ({
            intents: [
              {
                skill_level: 'beginner',
                intent_category: 'goal',
                intent_text: 'show my working tree status please',
              },
              {
                skill_level: 'intermediate',
                intent_category: 'symptom',
                intent_text: 'files look dirty but I am not sure why',
              },
            ],
            skips: allCells()
              .filter(
                (c) =>
                  !(
                    (c.skill_level === 'beginner' && c.intent_category === 'goal') ||
                    (c.skill_level === 'intermediate' && c.intent_category === 'symptom')
                  ),
              )
              .map((c) => ({ ...c, reason: 'n/a for status' })),
          }),
        }),
    });

    expect(result.inserted).toBeGreaterThanOrEqual(1);
    const db = openDb(stagingPath, { readonly: true });
    expect(countCommands(db)).toBe(1);
    expect(countIntents(db)).toBe(2);
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('persist drops foreign near-dup intents against existing recipe', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-expand-foreign-'));
    const stagingPath = path.join(dir, 'staging.db');

    // Seed recipe A with a distinctive intent
    {
      const db = openDb(stagingPath);
      const id = insertCommand(db, {
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git status', comment: 'a' }] },
        initial_state_physical_hash: 'hash-a-init',
        final_state_physical_hash: 'hash-a-final',
        risk: 0.05,
      });
      const text = 'unique-foreign-collision-phrase-alpha-omega';
      insertIntentWithEmbedding(db, {
        command_id: id,
        skill_level: 'beginner',
        intent_category: 'goal',
        intent_text: text,
        embedding: mockEmbed(text),
      });
      db.close();
    }

    const result = await runGroundStep({
      stagingPath,
      fresh: false,
      mock: true,
      skipEval: true,
      skipEvalBanks: true,
      concurrency: 1,
      groups: [
        {
          command: 'git log',
          blocks: [
            {
              metadata_source: 'fixture.md',
              content: 'Show log.\n\n```\ngit log\n```',
            },
          ],
        },
      ],
      generate: async () => ({
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git log', comment: 'b' }] },
        risk: 0.05,
      }),
      validate: (g) => validateInSandboxAndDestroy(g),
      expandIntents: async () => [
        {
          skill_level: 'beginner',
          intent_category: 'goal',
          // Near-identical to seeded intent → foreign prune at persist
          intent_text: 'unique-foreign-collision-phrase-alpha-omega',
        },
        {
          skill_level: 'beginner',
          intent_category: 'symptom',
          intent_text: 'totally-different-log-history-browse-query-zzz',
        },
      ],
    });

    expect(result.inserted).toBeGreaterThanOrEqual(1);
    const db = openDb(stagingPath, { readonly: true });
    expect(countCommands(db)).toBe(2);
    // Seeded 1 + one distinct from B (foreign clone dropped)
    expect(countIntents(db)).toBe(2);
    const texts = db
      .prepare('SELECT intent_text FROM intents ORDER BY row_id')
      .all()
      .map((r) => r.intent_text);
    expect(texts).toContain('unique-foreign-collision-phrase-alpha-omega');
    expect(texts).toContain('totally-different-log-history-browse-query-zzz');
    expect(texts.filter((t) => t === 'unique-foreign-collision-phrase-alpha-omega')).toHaveLength(1);
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('evolve path passes expandIntents hook (smoke)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-expand-evolve-'));
    const stagingPath = path.join(dir, 'staging.db');
    let expandCalls = 0;

    // Seed one leaf parent
    {
      const db = openDb(stagingPath);
      insertCommand(db, {
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git status', comment: 'parent' }] },
        initial_state_physical_hash: 'hash-p-init',
        final_state_physical_hash: 'hash-p-final',
        risk: 0.05,
        mutation_kind: null,
      });
      db.close();
    }

    await runBuildLoop({
      stagingPath,
      prodPath: path.join(dir, 'prod.db'),
      mock: true,
      skipGround: true,
      wipe: false,
      skipEval: true,
      skipEvalBanks: true,
      maxIterations: 1,
      concurrency: 1,
      exitZeroStreak: 1,
      taxonomyVerbs: ['git status'],
      evolve: async (parent) => ({
        initial_state: parent.initial_state,
        command_recipe: {
          commands: [{ command: 'git status -s', comment: 'flag' }],
        },
        risk: 0.05,
        mutation_kind: 'flag',
      }),
      validate: (g) => validateInSandboxAndDestroy(g),
      expandIntents: async () => {
        expandCalls += 1;
        return [
          {
            skill_level: 'beginner',
            intent_category: 'goal',
            intent_text: 'short status flag view evolve',
          },
        ];
      },
    });

    expect(expandCalls).toBeGreaterThanOrEqual(1);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('makeKnnForeign adapter returns neighbors from staging vec', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gh-expand-knn-'));
    const stagingPath = path.join(dir, 'staging.db');
    const db = openDb(stagingPath);
    const id = insertCommand(db, {
      initial_state: 'x',
      command_recipe: { commands: [{ command: 'git status' }] },
      initial_state_physical_hash: 'h1',
      final_state_physical_hash: 'h2',
      risk: 0.1,
    });
    const text = 'knn-adapter-unique-phrase';
    insertIntentWithEmbedding(db, {
      command_id: id,
      skill_level: 'beginner',
      intent_category: 'goal',
      intent_text: text,
      embedding: mockEmbed(text),
    });
    const knnForeign = makeKnnForeign(db, knnRecall, INTENT_FOREIGN_KNN_K);
    const hits = await knnForeign(mockEmbed(text));
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].command_id).toBe(id);
    expect(hits[0].similarity).toBeGreaterThan(0.9);
    db.close();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });
});
