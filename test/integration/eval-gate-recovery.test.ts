import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runEvalGateRecovery } from '../../common/src/build/evalRecovery/runEvalGateRecovery.ts';
import {
  snapshotGoldenBank,
  restoreGoldenBank,
} from '../../common/src/build/evalRecovery/bankHelpers.ts';
import { evalDataDir } from '../../common/src/lib/paths.ts';

describe('eval gate recovery integration', () => {
  let prior;
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rec-int-'));
    mkdirSync(evalDataDir(), { recursive: true });
    prior = snapshotGoldenBank();
  });

  afterEach(() => {
    restoreGoldenBank(prior);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (e?.code !== 'EBUSY' && e?.code !== 'ENOENT') throw e;
    }
  });

  it('polish accepts Pass A gain then early-stops on flat', async () => {
    restoreGoldenBank([
      { command_id: 1, query_text: 'status of repo', primary_verb: 'git status' },
      { command_id: 2, query_text: 'list and delete replace refs', primary_verb: 'git replace', mutation_kind: 'composition' },
    ]);

    const mkResult = (passed, hitPassed, missPass) => ({
      ok: true,
      okHit: true,
      okPass: true,
      passed,
      hitPassed,
      total: 2,
      rate: passed / 2,
      hitRate: hitPassed / 2,
      results: [
        {
          pass: true,
          via: 'hit@display',
          query: { command_id: 1, query_text: 'status of repo', primary_verb: 'git status' },
          displayed: [{ example: 'git status' }],
        },
        {
          pass: missPass,
          via: missPass ? 'judge' : 'ko',
          utility: missPass ? 0.95 : 0.4,
          query: {
            command_id: 2,
            query_text: 'list and delete replace refs',
            primary_verb: 'git replace',
            mutation_kind: 'composition',
          },
          displayed: [{ example: 'git replace -l', snippet: 'git replace -l' }],
        },
      ],
    });

    const start = mkResult(1, 1, false);
    let evalCalls = 0;
    const out = await runEvalGateRecovery({
      evalResult: start,
      evalFailRetryMax: 0,
      evalPolishRetryMax: 2,
      polishMissMin: 1,
      polishPassA: 0.95,
      skipEvalImprove: true,
      artifactsDir: path.join(dir, 'arts'),
      stagingPath: path.join(dir, 'x.db'),
      embedder: { embed: async () => new Float32Array(384) },
      reloadBank: () =>
        snapshotGoldenBank().map((r) => ({ ...r, kind: 'golden' })),
      runBankEval: async () => {
        evalCalls += 1;
        // first re-eval improves; subsequent flat
        if (evalCalls === 1) return mkResult(2, 1, true);
        return mkResult(2, 1, true);
      },
      llmJsonObject: async ({ schema }) => {
        if (schema?.shape?.items) {
          return {
            items: [
              {
                command_id: 2,
                query_text: 'list and delete replace refs',
                class: 'over_ask',
                constraint: 'one action',
                suggested_angle: 'list only',
              },
            ],
          };
        }
        return {
          actions: [
            {
              command_id: 2,
              op: 'rewrite',
              query_text: 'how to list git replace references',
            },
          ],
        };
      },
    });

    expect(out.evalResult.passed).toBe(2);
    expect(out.attempts.filter((a) => a.mode === 'polish').length).toBeGreaterThanOrEqual(1);
  });

  it('retrieval_sibling improve path accepts when improve round accepts', async () => {
    restoreGoldenBank([
      {
        command_id: 22,
        query_text: 'who wrote each line with annotate',
        primary_verb: 'git annotate',
      },
      {
        command_id: 23,
        query_text: 'backfill missing commits',
        primary_verb: 'git backfill',
      },
    ]);

    const before = {
      ok: false,
      okHit: true,
      okPass: false,
      passed: 0,
      hitPassed: 0,
      total: 2,
      rate: 0,
      hitRate: 0,
      results: [
        {
          pass: false,
          via: 'ko',
          utility: 0,
          query: {
            command_id: 22,
            query_text: 'who wrote each line with annotate',
            primary_verb: 'git annotate',
          },
          displayed: [{ example: 'git notes add', snippet: 'git notes add' }],
        },
        {
          pass: false,
          via: 'ko',
          utility: 0,
          query: {
            command_id: 23,
            query_text: 'backfill missing commits',
            primary_verb: 'git backfill',
          },
          displayed: [{ example: 'git fast-export', snippet: 'git fast-export' }],
        },
      ],
    };

    const after = {
      ...before,
      ok: true,
      okPass: true,
      passed: 2,
      hitPassed: 1,
      rate: 1,
      hitRate: 0.5,
      results: before.results.map((r) => ({ ...r, pass: true, via: 'judge', utility: 0.95 })),
    };

    // Mock runImproveRound by skipping to bank-only won't work for sibling.
    // Call recovery with skipEvalImprove false and llm that proposes verb_family;
    // runImproveRound needs taxonomy files — use temp traps/families.
    const trapsPath = path.join(dir, 'traps.json');
    const familiesPath = path.join(dir, 'families.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(trapsPath, JSON.stringify({ version: 1, traps: [] }));
    writeFileSync(familiesPath, JSON.stringify({ version: 1, families: [] }));

    const out = await runEvalGateRecovery({
      evalResult: before,
      evalFailRetryMax: 2,
      evalPolishRetryMax: 0,
      skipEvalImprove: false,
      trapsPath,
      familiesPath,
      taxonomyVerbs: [
        'git annotate',
        'git blame',
        'git backfill',
        'git notes',
        'git fast-export',
      ],
      artifactsDir: path.join(dir, 'arts-imp'),
      stagingPath: path.join(dir, 'x.db'),
      embedder: { embed: async () => new Float32Array(384) },
      reloadBank: () =>
        snapshotGoldenBank().map((r) => ({ ...r, kind: 'golden' })),
      runBankEval: async () => after,
      llmJsonObject: async ({ schema }) => {
        if (schema?.shape?.clusters) {
          return { clusters: [] };
        }
        if (schema?.shape?.proposals) {
          return {
            proposals: [
              {
                kind: 'verb_family',
                canonical: 'git blame',
                aliases: ['git annotate'],
                evidence_command_ids: [22],
              },
            ],
          };
        }
        if (schema?.shape?.items) return { items: [] };
        return { actions: [] };
      },
    });

    expect(out.ran).toBe(true);
    expect(out.evalResult.ok === true || out.attempts.length >= 1).toBe(true);
  });

  it('retrieval_sibling with skipEvalImprove stops as no_actions', async () => {
    restoreGoldenBank([
      {
        command_id: 5,
        query_text: 'who wrote each line annotate',
        primary_verb: 'git annotate',
      },
    ]);

    const red = {
      ok: false,
      okHit: true,
      okPass: false,
      passed: 0,
      hitPassed: 0,
      total: 1,
      rate: 0,
      hitRate: 0,
      results: [
        {
          pass: false,
          via: 'ko',
          query: {
            command_id: 5,
            query_text: 'who wrote each line annotate',
            primary_verb: 'git annotate',
          },
          displayed: [{ example: 'git notes add', snippet: 'git notes add' }],
        },
      ],
    };

    const out = await runEvalGateRecovery({
      evalResult: red,
      evalFailRetryMax: 2,
      evalPolishRetryMax: 0,
      skipEvalImprove: true,
      artifactsDir: path.join(dir, 'arts2'),
      stagingPath: path.join(dir, 'x.db'),
      embedder: { embed: async () => new Float32Array(384) },
      reloadBank: () =>
        snapshotGoldenBank().map((r) => ({ ...r, kind: 'golden' })),
      runBankEval: async () => red,
      llmJsonObject: async () => ({ items: [], actions: [] }),
    });

    expect(out.evalResult.ok).toBe(false);
    expect(out.attempts.some((a) => a.reason === 'no_actions')).toBe(true);
  });

  it('skipEvalRecovery does not mutate banks', async () => {
    restoreGoldenBank([
      { command_id: 1, query_text: 'status', primary_verb: 'git status' },
    ]);
    const before = snapshotGoldenBank();
    const evalResult = {
      ok: false,
      passed: 0,
      hitPassed: 0,
      total: 1,
      rate: 0,
      results: [
        {
          pass: false,
          via: 'miss',
          query: { command_id: 1, query_text: 'status', primary_verb: 'git status' },
          displayed: [],
        },
      ],
    };
    await runEvalGateRecovery({
      evalResult,
      skipEvalRecovery: true,
      runBankEval: async () => evalResult,
    });
    expect(snapshotGoldenBank()).toEqual(before);
  });

  it('no-verb miss → gap-check → coverage insert → accept mints birth golden', async () => {
    const { openDb, insertCommand, listCommands } = await import(
      '../../common/src/db/schema.js'
    );
    const { loadBank } = await import('../../common/src/build/evalGate.js');
    const { EMBEDDING_DIM } = await import('../../common/src/db/constants.js');
    const { existsSync, readFileSync } = await import('node:fs');

    const prevEval = process.env.GIT_GRASP_EVAL_DIR;
    const evalDir = mkdtempSync(path.join(tmpdir(), 'rec-birth-eval-'));
    process.env.GIT_GRASP_EVAL_DIR = evalDir;

    try {
      restoreGoldenBank([
        {
          command_id: 10,
          query_text: 'update branch without losing edits',
          primary_verb: 'git stash',
          mutation_kind: 'composition',
          source: 'llm',
        },
      ]);

      const dbPath = path.join(dir, 'staging.db');
      const db = openDb(dbPath);
      insertCommand(db, {
        initial_state: 'git commit --allow-empty -m init\n',
        command_recipe: { commands: [{ command: 'git stash' }] },
        initial_state_physical_hash: 'i1',
        final_state_physical_hash: 'f1',
        risk: 0.1,
        mutation_kind: null,
        title: 'Stash changes',
      });

      const red = {
        ok: false,
        okHit: false,
        okPass: false,
        passed: 0,
        hitPassed: 0,
        total: 1,
        rate: 0,
        hitRate: 0,
        results: [
          {
            pass: false,
            via: 'miss',
            query: {
              command_id: 10,
              query_text: 'update branch without losing edits',
              primary_verb: 'git stash',
              mutation_kind: 'composition',
            },
            displayed: [{ example: 'git stash', snippet: 'git stash' }],
          },
        ],
      };

      const green = {
        ...red,
        ok: true,
        okHit: true,
        okPass: true,
        passed: 1,
        hitPassed: 1,
        rate: 1,
        hitRate: 1,
        results: [{ ...red.results[0], pass: true, via: 'hit@display' }],
      };

      const childRecipe = {
        initial_state:
          'git commit --allow-empty -m init\necho x > f.txt\ngit add f.txt\n',
        command_recipe: {
          commands: [{ command: 'git stash' }, { command: 'git pull' }],
        },
        risk: 0.2,
        title: 'Stash then pull latest',
      };

      const bankLenBefore = snapshotGoldenBank().length;
      const cmdsBefore = listCommands(db).length;

      const out = await runEvalGateRecovery({
        evalResult: red,
        evalFailRetryMax: 1,
        evalPolishRetryMax: 0,
        skipEvalImprove: true,
        evalGapCheckMax: 5,
        evalCoverageMaxInserts: 1,
        artifactsDir: path.join(dir, 'arts-birth'),
        stagingPath: dbPath,
        db,
        taxonomyVerbs: ['git stash', 'git pull', 'git status'],
        embedder: { embed: async () => new Float32Array(EMBEDDING_DIM) },
        expandIntents: async () => [],
        validate: async (generated) => ({
          ok: true,
          ...generated,
          initial_state_physical_hash: 'i2',
          final_state_physical_hash: 'f2',
        }),
        expandQueries: async () => [
          { query_text: 'frustrated update keep edits' },
          { query_text: 'keep edits while updating branch' },
          { query_text: 'stash pull' },
        ],
        searchFn: async () => ({
          results: [{ command_id: 1, title: 'Stash', snippet: 'git stash' }],
        }),
        reloadBank: () =>
          snapshotGoldenBank().map((r) => ({ ...r, kind: 'golden' })),
        runBankEval: async () => green,
        llmJsonObject: async ({ messages }) => {
          const sys =
            (messages || []).find((m) => m.role === 'system')?.content || '';
          if (/match_command_id|accomplishes what the user/i.test(sys)) {
            return { match_command_id: null };
          }
          if (/Translate a user's Git goal/i.test(sys)) {
            return { verbs: ['git stash', 'git pull'] };
          }
          if (/COMPOSITION mutation/i.test(sys)) {
            return childRecipe;
          }
          throw new Error('skip polish');
        },
      });

      expect(out.attempts.some((a) => a.accepted)).toBe(true);
      expect(listCommands(db).length).toBe(cmdsBefore + 1);

      const birthPath = path.join(dir, 'arts-birth', 'fail-1', 'birth-goldens.json');
      expect(existsSync(birthPath)).toBe(true);
      const birth = JSON.parse(readFileSync(birthPath, 'utf8'));
      expect(birth[0].birth_query).toBe(true);
      expect(birth[0].query_text).toMatch(/without losing/i);

      // Birth golden appended after accept (bank grew).
      expect(snapshotGoldenBank().length).toBeGreaterThan(bankLenBefore);
      expect(
        loadBank('golden.jsonl').some(
          (r) => r.birth_query && /without losing/i.test(r.query_text),
        ),
      ).toBe(true);
      expect(loadBank('extended.jsonl').length).toBeGreaterThanOrEqual(3);

      db.close();
    } finally {
      if (prevEval === undefined) delete process.env.GIT_GRASP_EVAL_DIR;
      else process.env.GIT_GRASP_EVAL_DIR = prevEval;
      try {
        rmSync(evalDir, { recursive: true, force: true });
      } catch {
        /* */
      }
    }
  });
});
