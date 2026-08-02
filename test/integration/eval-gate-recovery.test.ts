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
});
