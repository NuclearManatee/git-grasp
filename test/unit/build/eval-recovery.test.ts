import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  classifyMiss,
  classifyEvalMisses,
  needsBankRewrite,
  needsImproveRound,
  needsCoverageGeneration,
} from '../../../common/src/build/evalRecovery/classifyMisses.ts';
import {
  shouldAcceptRecoveryAttempt,
  isFlatMetrics,
  metricsSlice,
} from '../../../common/src/build/evalRecovery/accept.ts';
import { buildRecipeVerbCoverage } from '../../../common/src/build/evalRecovery/coverageHelpers.ts';
import { recipeFingerprint } from '../../../common/src/build/dedup.ts';
import { polishRecipeHygiene } from '../../../common/src/build/polishRecipe.ts';
import {
  evalBankMeetsFloors,
  medianNumber,
} from '../../../common/src/build/evalGate.ts';
import {
  applyGoldenActions,
  snapshotGoldenBank,
  restoreGoldenBank,
  bankSizeFloorOk,
} from '../../../common/src/build/evalRecovery/bankHelpers.ts';
import { filterValidGoldenActions } from '../../../common/src/build/evalRecovery/rewriteGoldens.ts';
import { runEvalGateRecovery } from '../../../common/src/build/evalRecovery/runEvalGateRecovery.ts';
import { buildVerbFamilyIndex } from '../../../common/src/build/evalImprove/verbFamilies.ts';
import { evalDataDir } from '../../../common/src/lib/paths.ts';

describe('classifyMiss', () => {
  const familyIndex = buildVerbFamilyIndex({
    version: 1,
    families: [
      { canonical: 'git checkout', aliases: ['git switch'], source: 'seed' },
      { canonical: 'git blame', aliases: ['git annotate'], source: 'seed' },
    ],
  });

  it('flags retrieval_sibling on wrong displayed verb', () => {
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          query: { command_id: 1, query_text: 'backfill missing', primary_verb: 'git backfill' },
          displayed: [{ example: 'git fast-export HEAD', snippet: 'git fast-export HEAD' }],
        },
        { familyIndex },
      ),
    ).toBe('retrieval_sibling');
  });

  it('flags retrieval_sibling on empty display', () => {
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'miss',
          query: { command_id: 1, query_text: 'status', primary_verb: 'git status' },
          displayed: [],
        },
        { familyIndex },
      ),
    ).toBe('retrieval_sibling');
  });

  it('flags destructive_alt for revert vs reset', () => {
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.2,
          query: {
            command_id: 40,
            query_text: 'undo last commit with git revert',
            primary_verb: 'git revert',
          },
          displayed: [{ example: 'git reset --hard HEAD', snippet: 'git reset --hard HEAD' }],
        },
        { familyIndex },
      ),
    ).toBe('destructive_alt');
  });

  it('flags over_ask for composition multi-action with matching verb', () => {
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.4,
          query: {
            command_id: 57,
            query_text: 'list git replace references and delete one',
            primary_verb: 'git replace',
            mutation_kind: 'composition',
          },
          displayed: [{ example: 'git replace -l', snippet: 'git replace -l' }],
        },
        { familyIndex },
      ),
    ).toBe('over_ask');
  });

  it('flags partial_multistep for matching verb + multi cue without composition', () => {
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.5,
          query: {
            command_id: 9,
            query_text: 'repack and garbage collect',
            primary_verb: 'git repack',
            mutation_kind: 'ground',
          },
          displayed: [{ example: 'git repack', snippet: 'git repack' }],
        },
        { familyIndex },
      ),
    ).toBe('partial_multistep');
  });

  it('treats family mate display as not retrieval_sibling', () => {
    const cls = classifyMiss(
      {
        pass: false,
        via: 'ko',
        utility: 0.3,
        query: {
          command_id: 2,
          query_text: 'switch branches',
          primary_verb: 'git checkout',
        },
        displayed: [{ example: 'git switch main', snippet: 'git switch main' }],
      },
      { familyIndex },
    );
    expect(cls).not.toBe('retrieval_sibling');
  });

  it('returns other for ambiguous low-signal miss', () => {
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.95,
          query: {
            command_id: 3,
            query_text: 'show status',
            primary_verb: 'git status',
          },
          displayed: [{ example: 'git status', snippet: 'git status' }],
        },
        { familyIndex },
      ),
    ).toBe('other');
  });

  it('needsBankRewrite / needsImproveRound partition levers', () => {
    const classified = classifyEvalMisses(
      [
        {
          pass: false,
          via: 'ko',
          query: {
            command_id: 1,
            query_text: 'list and delete replace',
            primary_verb: 'git replace',
            mutation_kind: 'composition',
          },
          displayed: [{ example: 'git replace -l', snippet: 'git replace -l' }],
        },
        {
          pass: false,
          via: 'ko',
          query: { command_id: 2, query_text: 'backfill', primary_verb: 'git backfill' },
          displayed: [{ example: 'git fast-export', snippet: 'git fast-export' }],
        },
      ],
      { familyIndex },
    );
    expect(needsBankRewrite(classified)).toBe(true);
    expect(needsImproveRound(classified)).toBe(true);
  });

  it('flags coverage_gap when multi-verb query has no covering recipe', () => {
    const coverage = buildRecipeVerbCoverage([
      {
        row_id: 1,
        command_recipe: {
          commands: [{ command: 'git prune' }],
        },
      },
    ]);
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.4,
          query: {
            command_id: 59,
            query_text:
              'show unreachable objects with git fsck and clean them up with git prune',
            primary_verb: 'git fsck',
            mutation_kind: 'composition',
          },
          displayed: [{ example: 'git prune', snippet: 'git prune' }],
        },
        { familyIndex, recipeVerbCoverage: coverage },
      ),
    ).toBe('coverage_gap');
  });

  it('does not treat "git repository" as a second verb for coverage_gap', () => {
    const coverage = buildRecipeVerbCoverage([
      {
        row_id: 13,
        command_recipe: {
          commands: [{ command: 'git count-objects' }],
        },
      },
    ]);
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.3,
          query: {
            command_id: 13,
            query_text:
              'How to count loose objects in the git repository with git count-objects?',
            primary_verb: 'git count-objects',
          },
          displayed: [{ example: 'git fsck', snippet: 'git fsck' }],
        },
        { familyIndex, recipeVerbCoverage: coverage },
      ),
    ).toBe('retrieval_sibling');
  });

  it('does not flag coverage_gap when a composite recipe already covers verbs', () => {
    const coverage = buildRecipeVerbCoverage([
      {
        row_id: 2,
        command_recipe: {
          commands: [
            { command: 'git fsck --unreachable' },
            { command: 'git prune' },
          ],
        },
      },
    ]);
    const cls = classifyMiss(
      {
        pass: false,
        via: 'ko',
        utility: 0.4,
        query: {
          command_id: 59,
          query_text:
            'show unreachable objects with git fsck and clean them up with git prune',
          primary_verb: 'git fsck',
          mutation_kind: 'composition',
        },
        displayed: [{ example: 'git prune', snippet: 'git prune' }],
      },
      { familyIndex, recipeVerbCoverage: coverage },
    );
    expect(cls).not.toBe('coverage_gap');
  });

  it('needsCoverageGeneration detects coverage_gap class', () => {
    expect(
      needsCoverageGeneration([{ class: 'coverage_gap' }, { class: 'other' }]),
    ).toBe(true);
    expect(needsCoverageGeneration([{ class: 'retrieval_sibling' }])).toBe(false);
  });
});

describe('additive-only accept', () => {
  it('allows commandsUnchanged=false when additiveOnly', () => {
    const r = shouldAcceptRecoveryAttempt({
      mode: 'fail',
      before: { passed: 40, hitPassed: 40, ok: false },
      after: { passed: 41, hitPassed: 40, ok: false },
      holdoutBefore: { total: 0, hitRate: 1, rate: 1 },
      holdoutAfter: { total: 0, hitRate: 1, rate: 1 },
      bankBeforeLen: 100,
      bankAfterLen: 100,
      bankFloor: 0.85,
      commandsUnchanged: false,
      additiveOnly: true,
    });
    expect(r.ok).toBe(true);
  });

  it('rejects non-additive command changes', () => {
    expect(
      shouldAcceptRecoveryAttempt({
        mode: 'fail',
        before: { passed: 40, hitPassed: 40, ok: false },
        after: { passed: 41, hitPassed: 40, ok: false },
        holdoutBefore: { total: 0, hitRate: 1, rate: 1 },
        holdoutAfter: { total: 0, hitRate: 1, rate: 1 },
        bankBeforeLen: 100,
        bankAfterLen: 100,
        bankFloor: 0.85,
        commandsUnchanged: false,
        additiveOnly: false,
      }).reason,
    ).toBe('commands_changed');
  });
});

describe('eval bank floors + judge median', () => {
  it('evalBankMeetsFloors uses absolute counts', () => {
    const bank = Array.from({ length: 150 }, (_, i) => ({
      command_id: i + 1,
      mutation_kind: i < 30 ? 'composition' : 'ground',
    }));
    expect(evalBankMeetsFloors(bank).ok).toBe(true);
    expect(evalBankMeetsFloors(bank.slice(0, 100)).ok).toBe(false);
    expect(
      evalBankMeetsFloors(
        Array.from({ length: 150 }, (_, i) => ({
          command_id: i + 1,
          mutation_kind: 'ground',
        })),
      ).ok,
    ).toBe(false);
  });

  it('medianNumber picks middle', () => {
    expect(medianNumber([0.7, 0.9, 0.5])).toBe(0.7);
    expect(medianNumber([0.8, 0.9])).toBeCloseTo(0.85);
  });
});

describe('polishRecipeHygiene fingerprint gate', () => {
  it('keeps original when fingerprint would change', async () => {
    const recipe = {
      initial_state: 'git commit --allow-empty -m init',
      command_recipe: {
        commands: [{ command: 'git status', comment: 'sandbox note about f.txt' }],
      },
      risk: 0.1,
      initial_state_physical_hash: 'a',
      final_state_physical_hash: 'b',
    };
    const before = recipeFingerprint(recipe.command_recipe);
    const out = await polishRecipeHygiene(recipe, {
      skipSandbox: true,
      llmJsonObject: async () => ({
        initial_state: recipe.initial_state,
        command_recipe: {
          commands: [{ command: 'git diff', comment: 'changed verb' }],
        },
        risk: 0.1,
      }),
    });
    expect(recipeFingerprint(out.command_recipe)).toBe(before);
    expect(out.command_recipe.commands[0].command).toBe('git status');
  });

  it('accepts comment-only polish with matching fingerprint', async () => {
    const recipe = {
      initial_state: 'git commit --allow-empty -m init',
      command_recipe: {
        commands: [{ command: 'git status', comment: 'blob for f.txt' }],
      },
      risk: 0.1,
      initial_state_physical_hash: 'a',
      final_state_physical_hash: 'b',
    };
    const out = await polishRecipeHygiene(recipe, {
      skipSandbox: true,
      llmJsonObject: async () => ({
        initial_state: recipe.initial_state,
        command_recipe: {
          commands: [{ command: 'git status', comment: 'Show working tree status' }],
        },
        risk: 0.1,
      }),
    });
    expect(out.command_recipe.commands[0].comment).toBe('Show working tree status');
  });
});

describe('shouldAcceptRecoveryAttempt', () => {
  const base = {
    holdoutBefore: { total: 0, hitRate: 1, rate: 1 },
    holdoutAfter: { total: 0, hitRate: 1, rate: 1 },
    bankBeforeLen: 100,
    bankAfterLen: 100,
    bankFloor: 0.85,
    commandsUnchanged: true,
  };

  it('accepts fail-retry when gate turns green', () => {
    expect(
      shouldAcceptRecoveryAttempt({
        ...base,
        mode: 'fail',
        before: { passed: 40, hitPassed: 40, ok: false },
        after: { passed: 45, hitPassed: 45, ok: true },
      }).ok,
    ).toBe(true);
  });

  it('rejects hit@display drop', () => {
    expect(
      shouldAcceptRecoveryAttempt({
        ...base,
        mode: 'fail',
        before: { passed: 40, hitPassed: 40, ok: false },
        after: { passed: 42, hitPassed: 38, ok: false },
      }).reason,
    ).toBe('hit_display_drop');
  });

  it('rejects holdout pass drop', () => {
    expect(
      shouldAcceptRecoveryAttempt({
        ...base,
        mode: 'fail',
        before: { passed: 40, hitPassed: 40, ok: false },
        after: { passed: 42, hitPassed: 40, ok: false },
        holdoutBefore: { total: 3, hitRate: 0.5, rate: 0.6 },
        holdoutAfter: { total: 3, hitRate: 0.5, rate: 0.3 },
      }).reason,
    ).toBe('holdout_pass_drop');
  });

  it('polish requires gate stay green and pass gain', () => {
    expect(
      shouldAcceptRecoveryAttempt({
        ...base,
        mode: 'polish',
        bankFloor: 0.95,
        before: { passed: 45, hitPassed: 45, ok: true },
        after: { passed: 46, hitPassed: 45, ok: true },
      }).ok,
    ).toBe(true);
    expect(
      shouldAcceptRecoveryAttempt({
        ...base,
        mode: 'polish',
        bankFloor: 0.95,
        before: { passed: 45, hitPassed: 45, ok: true },
        after: { passed: 46, hitPassed: 45, ok: false },
      }).reason,
    ).toBe('polish_lost_gate');
  });

  it('detects flat metrics', () => {
    expect(isFlatMetrics({ passed: 1, hitPassed: 1 }, { passed: 1, hitPassed: 1 })).toBe(
      true,
    );
    expect(isFlatMetrics({ passed: 1, hitPassed: 1 }, { passed: 2, hitPassed: 1 })).toBe(
      false,
    );
  });

  it('bankSizeFloorOk', () => {
    expect(bankSizeFloorOk(100, 85, 'fail')).toBe(true);
    expect(bankSizeFloorOk(100, 84, 'fail')).toBe(false);
    expect(bankSizeFloorOk(100, 95, 'polish')).toBe(true);
  });
});

describe('golden bank apply / rollback', () => {
  let prev;
  let tmpEval;

  beforeEach(() => {
    prev = process.env.GIT_GRASP_ROOT;
    tmpEval = mkdtempSync(path.join(tmpdir(), 'eval-bank-'));
    const root = mkdtempSync(path.join(tmpdir(), 'gg-root-'));
    mkdirSync(path.join(root, 'common', 'data', 'eval'), { recursive: true });
    mkdirSync(path.join(root, 'common', 'config'), { recursive: true });
    writeFileSync(path.join(root, 'common', 'config', 'thresholds.json'), '{}');
    // Point eval via writing directly using restore after patching — use write to evalDataDir
    // Package root discovery is sticky; write into real evalDataDir with unique prefix via writeBank path.
    process.env.GIT_GRASP_ROOT = root;
  });

  afterEach(() => {
    if (prev == null) delete process.env.GIT_GRASP_ROOT;
    else process.env.GIT_GRASP_ROOT = prev;
    try {
      rmSync(tmpEval, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('filterValidGoldenActions enforces primary verb token', () => {
    const missByCommandId = new Map([
      [
        1,
        {
          command_id: 1,
          primary_verb: 'git revert',
          row: { reason: 'dangerous reset' },
        },
      ],
    ]);
    const ok = filterValidGoldenActions(
      [{ command_id: 1, op: 'rewrite', query_text: 'how to revert the last commit safely' }],
      missByCommandId,
    );
    expect(ok.actions).toHaveLength(1);
    const bad = filterValidGoldenActions(
      [{ command_id: 1, op: 'rewrite', query_text: 'undo without naming the tool' }],
      missByCommandId,
    );
    expect(bad.actions).toHaveLength(0);
    expect(bad.errors.some((e) => e.includes('primary verb'))).toBe(true);
  });
});

describe('runEvalGateRecovery budgets', () => {
  it('skipEvalRecovery returns unchanged', async () => {
    const evalResult = { ok: false, passed: 1, hitPassed: 1, total: 2, rate: 0.5, results: [] };
    const out = await runEvalGateRecovery({
      evalResult,
      skipEvalRecovery: true,
      runBankEval: async () => evalResult,
    });
    expect(out.ran).toBe(false);
    expect(out.evalResult).toBe(evalResult);
  });

  it('stops when no actionable classes', async () => {
    const evalResult = {
      ok: false,
      okHit: true,
      okPass: false,
      passed: 1,
      hitPassed: 1,
      total: 2,
      rate: 0.5,
      hitRate: 0.5,
      results: [
        {
          pass: true,
          via: 'hit@display',
          query: { command_id: 1, query_text: 'ok', primary_verb: 'git status' },
          displayed: [{ example: 'git status' }],
        },
        {
          pass: false,
          via: 'ko',
          utility: 0.95,
          query: { command_id: 2, query_text: 'status please', primary_verb: 'git status' },
          displayed: [{ example: 'git status', snippet: 'git status' }],
        },
      ],
    };
    const dir = mkdtempSync(path.join(tmpdir(), 'rec-'));
    const out = await runEvalGateRecovery({
      evalResult,
      evalFailRetryMax: 4,
      evalPolishRetryMax: 0,
      artifactsDir: dir,
      runBankEval: async () => evalResult,
      embedder: { embed: async () => new Float32Array(384) },
      stagingPath: path.join(dir, 'x.db'),
    });
    expect(out.attempts.some((a) => a.reason === 'no_actions')).toBe(true);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (e?.code !== 'EBUSY' && e?.code !== 'ENOENT') throw e;
    }
  });

  it('fail-retry bank rewrite can accept green re-eval', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rec-fail-'));
    // Isolate banks: write into PACKAGE eval via restoreGoldenBank after ensuring dir
    const goldenDir = evalDataDir();
    mkdirSync(goldenDir, { recursive: true });
    const prior = snapshotGoldenBank();
    restoreGoldenBank([
      {
        command_id: 10,
        query_text: 'list replace refs and delete one',
        primary_verb: 'git replace',
        mutation_kind: 'composition',
      },
      {
        command_id: 11,
        query_text: 'simple status',
        primary_verb: 'git status',
        mutation_kind: 'ground',
      },
    ]);

    const before = {
      ok: false,
      okHit: true,
      okPass: false,
      passed: 1,
      hitPassed: 1,
      total: 2,
      rate: 0.5,
      hitRate: 0.5,
      results: [
        {
          pass: false,
          via: 'ko',
          utility: 0.4,
          query: {
            command_id: 10,
            query_text: 'list replace refs and delete one',
            primary_verb: 'git replace',
            mutation_kind: 'composition',
          },
          displayed: [{ example: 'git replace -l', snippet: 'git replace -l' }],
        },
        {
          pass: true,
          via: 'hit@display',
          query: {
            command_id: 11,
            query_text: 'simple status',
            primary_verb: 'git status',
            mutation_kind: 'ground',
          },
          displayed: [{ example: 'git status' }],
        },
      ],
    };

    const afterGreen = {
      ...before,
      ok: true,
      okPass: true,
      passed: 2,
      rate: 1,
      results: before.results.map((r, i) =>
        i === 0 ? { ...r, pass: true, via: 'judge', utility: 0.95 } : r,
      ),
    };

    let evalCalls = 0;
    const out = await runEvalGateRecovery({
      evalResult: before,
      evalFailRetryMax: 4,
      evalPolishRetryMax: 0,
      skipEvalImprove: true,
      artifactsDir: path.join(dir, 'arts'),
      stagingPath: path.join(dir, 'x.db'),
      embedder: { embed: async () => new Float32Array(384) },
      reloadBank: () =>
        snapshotGoldenBank().map((r) => ({
          ...r,
          kind: 'golden',
        })),
      runBankEval: async () => {
        evalCalls += 1;
        return afterGreen;
      },
      llmJsonObject: async ({ schema }) => {
        if (schema?.shape?.items) {
          return {
            items: [
              {
                command_id: 10,
                query_text: 'list replace refs and delete one',
                class: 'over_ask',
                constraint: 'single action',
                suggested_angle: 'only list',
              },
            ],
          };
        }
        return {
          actions: [
            {
              command_id: 10,
              op: 'rewrite',
              query_text: 'how to list git replace references',
            },
          ],
        };
      },
    });

    expect(evalCalls).toBeGreaterThanOrEqual(1);
    expect(out.evalResult.ok).toBe(true);
    expect(out.attempts.some((a) => a.accepted)).toBe(true);

    restoreGoldenBank(prior);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (e?.code !== 'EBUSY' && e?.code !== 'ENOENT') throw e;
    }
  });

  it('detectGaps reclassifies no-verb miss so coverage lever can run', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rec-gap-'));
    mkdirSync(evalDataDir(), { recursive: true });
    const prior = snapshotGoldenBank();
    restoreGoldenBank([
      {
        command_id: 10,
        query_text: 'update branch without losing edits',
        primary_verb: 'git stash',
        mutation_kind: 'composition',
      },
    ]);

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

    let coverageCalled = false;
    const out = await runEvalGateRecovery({
      evalResult: red,
      evalFailRetryMax: 1,
      evalPolishRetryMax: 0,
      skipEvalImprove: true,
      evalGapCheckMax: 5,
      evalCoverageMaxInserts: 1,
      artifactsDir: dir,
      stagingPath: path.join(dir, 'x.db'),
      embedder: { embed: async () => new Float32Array(384) },
      recipeVerbCoverage: [
        { row_id: 1, verbs: new Set(['git stash']), mutation_kind: null },
      ],
      searchFn: async () => ({
        results: [{ command_id: 1, title: 'Stash', snippet: 'git stash' }],
      }),
      reloadBank: () =>
        snapshotGoldenBank().map((r) => ({ ...r, kind: 'golden' })),
      runBankEval: async () => red,
      llmJsonObject: async ({ messages }) => {
        const sys = (messages || []).find((m) => m.role === 'system')?.content || '';
        if (/accomplishes what the user query asks/i.test(sys) || /match_command_id/i.test(sys)) {
          return { match_command_id: null };
        }
        if (/Translate a user's Git goal/i.test(sys)) {
          coverageCalled = true;
          return { verbs: ['git stash', 'git pull'] };
        }
        return { items: [], actions: [], verbs: ['git stash', 'git pull'] };
      },
    });

    // Coverage may fail insert (no parent DB), but gap-check must have run and
    // attempt should not be a silent no_actions from sibling-only class.
    expect(out.attempts.length).toBeGreaterThanOrEqual(1);
    const gapFile = path.join(dir, 'fail-1', 'gap-checks.json');
    const { readFileSync, existsSync } = await import('node:fs');
    expect(existsSync(gapFile)).toBe(true);
    const checks = JSON.parse(readFileSync(gapFile, 'utf8'));
    expect(checks[0].class).toBe('coverage_gap');
    expect(coverageCalled || checks[0].reason === 'no_match').toBe(true);

    restoreGoldenBank(prior);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      if (e?.code !== 'EBUSY' && e?.code !== 'ENOENT') throw e;
    }
  });

  it('polish drop-only exceeding floor is no-op / reject', () => {
    const before = Array.from({ length: 20 }, (_, i) => ({
      command_id: i + 1,
      query_text: `q${i}`,
      primary_verb: 'git status',
    }));
    // Simulate apply without touching real disk: unit the helper with temp via restore
    const prior = snapshotGoldenBank();
    restoreGoldenBank(before);
    const actions = before.slice(0, 3).map((r) => ({
      command_id: r.command_id,
      op: 'drop',
    }));
    const applied = applyGoldenActions(actions, { mode: 'polish', allowDrop: true });
    expect(applied.ok).toBe(false);
    expect(applied.reason).toMatch(/polish_drop_only|bank_size/);
    restoreGoldenBank(prior);
  });
});
