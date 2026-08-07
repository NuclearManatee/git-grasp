import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, insertCommand, getCommand, listCommands } from '../../../common/src/db/schema.ts';
import { EMBEDDING_DIM } from '../../../common/src/db/constants.ts';
import {
  pickCoverageParent,
  filterKnownVerbs,
  normalizeGoalVerb,
  resolveCoverageVerbs,
  generateCoverageGapComposites,
  rollbackCoverageInserts,
  goalToVerbs,
} from '../../../common/src/build/evalRecovery/generateCoverage.ts';
import {
  mintBirthQueryGoldens,
} from '../../../common/src/build/evalRecovery/runEvalGateRecovery.ts';
import {
  loadBank,
} from '../../../common/src/build/evalGate.ts';
import { snapshotGoldenBank as snapBank, restoreGoldenBank as restoreBank } from '../../../common/src/build/evalRecovery/bankHelpers.ts';

describe('goal verb helpers', () => {
  it('normalizeGoalVerb prefixes git', () => {
    expect(normalizeGoalVerb('stash')).toBe('git stash');
    expect(normalizeGoalVerb('git pull')).toBe('git pull');
  });

  it('filterKnownVerbs drops unknowns', () => {
    expect(
      filterKnownVerbs(['git stash', 'git invent', 'pull'], [
        'git stash',
        'git pull',
        'git status',
      ]),
    ).toEqual(['git stash', 'git pull']);
  });

  it('goalToVerbs validates against known list', async () => {
    const verbs = await goalToVerbs('save work then pull latest', {
      knownVerbs: ['git stash', 'git pull', 'git status'],
      llmJsonObject: async () => ({
        verbs: ['git stash', 'git pull', 'git madeup'],
      }),
    });
    expect(verbs).toEqual(['git stash', 'git pull']);
  });
});

describe('pickCoverageParent', () => {
  it('picks parent with partial overlap preferring primary', () => {
    const commands = [
      {
        row_id: 1,
        command_recipe: { commands: [{ command: 'git stash' }] },
      },
      {
        row_id: 2,
        command_recipe: {
          commands: [{ command: 'git pull --rebase' }, { command: 'git status' }],
        },
      },
    ];
    const parent = pickCoverageParent(
      commands,
      ['git stash', 'git pull'],
      'git stash',
    );
    expect(parent.row_id).toBe(1);
  });

  it('skips parents that already fully cover', () => {
    const commands = [
      {
        row_id: 1,
        command_recipe: {
          commands: [{ command: 'git stash' }, { command: 'git pull' }],
        },
      },
    ];
    expect(
      pickCoverageParent(commands, ['git stash', 'git pull'], 'git stash'),
    ).toBeNull();
  });
});

describe('resolveCoverageVerbs', () => {
  it('uses query verbs when present', async () => {
    const r = await resolveCoverageVerbs({
      query_text: 'git stash then git pull',
    });
    expect(r.verbSource).toBe('query');
    expect(r.needed).toEqual(['git stash', 'git pull']);
  });

  it('falls back to goal-to-verbs for goal-shaped queries', async () => {
    const r = await resolveCoverageVerbs(
      { query_text: 'update branch without losing edits', primary_verb: 'git stash' },
      {
        taxonomyVerbs: ['git stash', 'git pull', 'git status'],
        llmJsonObject: async () => ({ verbs: ['stash', 'pull'] }),
      },
    );
    expect(r.verbSource).toBe('goal_to_verbs');
    expect(r.needed).toEqual(['git stash', 'git pull']);
  });

  it('reports need_two_verbs when goal yields fewer than 2', async () => {
    const r = await resolveCoverageVerbs(
      { query_text: 'vague ask' },
      {
        taxonomyVerbs: ['git status'],
        llmJsonObject: async () => ({ verbs: ['git status'] }),
      },
    );
    expect(r.reason).toBe('need_two_verbs');
  });
});

describe('generateCoverageGapComposites', () => {
  it('early-exits when verbs cannot be resolved', async () => {
    const db = openDb(':memory:');
    const out = await generateCoverageGapComposites(
      [{ command_id: 1, query_text: 'vague goal ask', primary_verb: 'git stash' }],
      {
        db,
        stagingPath: ':memory:',
        embedder: { embed: async () => new Float32Array(EMBEDDING_DIM) },
        taxonomyVerbs: ['git stash', 'git pull'],
        llmJsonObject: async () => ({ verbs: ['git stash'] }),
      },
    );
    expect(out.insertedIds).toHaveLength(0);
    expect(out.attempts[0].reason).toBe('need_two_verbs');
    expect(out.attempts[0].verbSource).toBe('goal_to_verbs');
    db.close();
  });

  it('inserts composition child via goal-to-verbs and records birthQueries', async () => {
    const db = openDb(':memory:');
    const parentId = insertCommand(db, {
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: { commands: [{ command: 'git stash' }] },
      initial_state_physical_hash: 'i1',
      final_state_physical_hash: 'f1',
      risk: 0.1,
      mutation_kind: null,
      title: 'Stash changes',
    });

    const childRecipe = {
      initial_state: 'git commit --allow-empty -m init\necho x > f.txt\ngit add f.txt\n',
      command_recipe: {
        commands: [{ command: 'git stash' }, { command: 'git pull' }],
      },
      risk: 0.2,
      title: 'Stash then pull latest',
    };

    const out = await generateCoverageGapComposites(
      [
        {
          command_id: 99,
          query_text: 'update my branch without losing uncommitted work',
          primary_verb: 'git stash',
        },
      ],
      {
        db,
        stagingPath: ':memory:',
        embedder: { embed: async () => new Float32Array(EMBEDDING_DIM) },
        taxonomyVerbs: ['git stash', 'git pull', 'git status'],
        expandIntents: async () => [],
        validate: async (generated) => ({
          ok: true,
          ...generated,
          initial_state_physical_hash: 'i2',
          final_state_physical_hash: 'f2',
        }),
        llmJsonObject: async ({ messages }) => {
          const blob = JSON.stringify(messages);
          if (blob.includes('Known verbs') || blob.includes('goal-to-verbs') || /Translate a user's Git goal/i.test(blob) || blob.includes('update my branch')) {
            // goal-to-verbs OR polish — detect by system content
            const sys = (messages || []).find((m) => m.role === 'system')?.content || '';
            if (/Translate a user's Git goal/i.test(sys)) {
              return { verbs: ['git stash', 'git pull'] };
            }
            if (/polish|hygiene|idiomatic/i.test(sys)) {
              throw new Error('skip polish');
            }
            if (/COMPOSITION mutation/i.test(sys)) {
              return childRecipe;
            }
            // gap-check not used here
            return { verbs: ['git stash', 'git pull'] };
          }
          if (/COMPOSITION mutation/i.test(
            (messages || []).find((m) => m.role === 'system')?.content || '',
          )) {
            return childRecipe;
          }
          throw new Error('skip polish');
        },
      },
    );

    expect(out.insertedIds.length).toBe(1);
    expect(out.birthQueries).toHaveLength(1);
    expect(out.birthQueries[0].query_text).toMatch(/without losing/i);
    expect(out.birthQueries[0].verbSource).toBe('goal_to_verbs');
    expect(out.attempts[0].reason).toBe('inserted');
    expect(getCommand(db, out.insertedIds[0])).toBeTruthy();
    expect(listCommands(db).length).toBeGreaterThan(1);

    const rolled = rollbackCoverageInserts(':memory:', out.insertedIds, db);
    expect(rolled.deleted).toBe(1);
    expect(getCommand(db, out.insertedIds[0])).toBeFalsy();
    expect(getCommand(db, parentId)).toBeTruthy();
    db.close();
  });
});

describe('mintBirthQueryGoldens', () => {
  let evalDir;
  let prevEvalDir;
  let prior;

  beforeEach(() => {
    evalDir = mkdtempSync(path.join(tmpdir(), 'birth-golden-'));
    prevEvalDir = process.env.GIT_GRASP_EVAL_DIR;
    process.env.GIT_GRASP_EVAL_DIR = evalDir;
    prior = snapBank();
    restoreBank([]);
  });

  afterEach(() => {
    restoreBank(prior);
    if (prevEvalDir === undefined) delete process.env.GIT_GRASP_EVAL_DIR;
    else process.env.GIT_GRASP_EVAL_DIR = prevEvalDir;
    try {
      rmSync(evalDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('appends gap query as golden with extended/scrambled after accept', async () => {
    const db = openDb(':memory:');
    const row_id = insertCommand(db, {
      initial_state: 'git commit --allow-empty -m init\n',
      command_recipe: {
        commands: [{ command: 'git stash' }, { command: 'git pull --rebase' }],
      },
      initial_state_physical_hash: 'i',
      final_state_physical_hash: 'f',
      risk: 0.2,
      mutation_kind: 'composition',
      title: 'Stash then pull',
    });

    const minted = await mintBirthQueryGoldens(
      [
        {
          row_id,
          query_text: 'update branch without losing edits',
          primary_verb: 'git stash',
        },
      ],
      {
        db,
        expandQueries: async () => [
          { query_text: 'frustrated save then update' },
          { query_text: 'keep my edits while updating' },
          { query_text: 'stash pull rebase' },
        ],
      },
    );

    expect(minted).toHaveLength(1);
    expect(minted[0].birth_query).toBe(true);
    expect(minted[0].source).toBe('llm');
    expect(minted[0].command_id).toBe(row_id);

    const golden = loadBank('golden.jsonl');
    expect(golden.some((r) => r.command_id === row_id && r.birth_query)).toBe(true);
    expect(loadBank('extended.jsonl').length).toBe(3);
    expect(loadBank('scrambled.jsonl').length).toBe(3);
    db.close();
  });
});
