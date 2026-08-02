import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadLexiconTraps,
  readLexiconTrapsFile,
} from '../../../common/src/build/evalImprove/lexiconTraps.ts';
import {
  buildVerbFamilyIndex,
  verbsInFamily,
  readVerbFamiliesFile,
} from '../../../common/src/build/evalImprove/verbFamilies.ts';
import {
  splitTrainHoldoutByCommandId,
  stableCommandIdHash,
} from '../../../common/src/build/evalImprove/splitHoldout.ts';
import {
  validateProposalBatch,
  needleCopiesJudgeReason,
  isForbiddenVerbFamilyPair,
  trapEvidenceMeetsGenerality,
  queryMentionsVerb,
  goldensDistinguishFamilyMembers,
} from '../../../common/src/build/evalImprove/validateProposals.ts';
import {
  pruneDistinguishedEvalRoundFamilies,
} from '../../../common/src/build/evalImprove/verbFamilies.ts';
import {
  shouldAcceptImproveRound,
  metricsForCommandIds,
  applyProposalsToTaxonomy,
  restoreTaxonomySnapshot,
} from '../../../common/src/build/evalImprove/runImproveRound.ts';
import {
  shouldRunEvalImprove,
  maybeRunEvalImprove,
} from '../../../common/src/build/evalImprove/maybeRunEvalImprove.ts';
import { filterIntentsForRecipe } from '../../../common/src/build/intentFidelity.ts';
import { hitAtDisplayVerb } from '../../../common/src/build/evalGate.ts';
import { countEvalMisses } from '../../../common/src/build/evalImprove/collectMisses.ts';

describe('evalImprove taxonomy loaders', () => {
  it('loads seed lexicon traps from checked-in JSON', () => {
    const traps = loadLexiconTraps();
    expect(traps.length).toBeGreaterThanOrEqual(3);
    expect(traps.some((t) => t.role === 'authorship_vs_bisect')).toBe(true);
    expect(traps[0].needles.test('who wrote this line')).toBe(true);
  });

  it('filterIntentsForRecipe drops poisoned intents via JSON traps', () => {
    const recipe = {
      command_recipe: { commands: [{ command: 'git bisect start' }] },
    };
    const out = filterIntentsForRecipe(recipe, [
      { skill_level: 'beginner', intent_category: 'discover', intent_text: 'who wrote each line of this file' },
      { skill_level: 'beginner', intent_category: 'discover', intent_text: 'binary search which commit broke main' },
    ]);
    expect(out.map((i) => i.intent_text)).toEqual([
      'binary search which commit broke main',
    ]);
  });
});

describe('verb families', () => {
  it('verbsInFamily is undirected', () => {
    const idx = buildVerbFamilyIndex({
      version: 1,
      families: [
        { canonical: 'git checkout', aliases: ['git switch'], source: 'seed' },
      ],
    });
    expect([...verbsInFamily('git switch', idx)].sort()).toEqual([
      'git checkout',
      'git switch',
    ]);
  });

  it('hitAtDisplayVerb Pass B accepts family mate', () => {
    const idx = buildVerbFamilyIndex({
      version: 1,
      families: [
        { canonical: 'git checkout', aliases: ['git switch'], source: 'seed' },
      ],
    });
    const hits = [{ command_id: 2, snippet: 'git switch main' }];
    expect(hitAtDisplayVerb(hits, 'git checkout', {}, idx)).toBe(true);
    expect(hitAtDisplayVerb(hits, 'git rebase', {}, idx)).toBe(false);
  });
});

describe('train/holdout split', () => {
  it('is stable by command_id', () => {
    const misses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((id) => [
      { query: { command_id: id, query_text: `q${id}` }, pass: false },
    ]);
    const a = splitTrainHoldoutByCommandId(misses);
    const b = splitTrainHoldoutByCommandId(misses);
    expect([...a.trainIds].sort()).toEqual([...b.trainIds].sort());
    expect([...a.holdoutIds].sort()).toEqual([...b.holdoutIds].sort());
    expect(a.trainIds.size + a.holdoutIds.size).toBe(10);
    expect(stableCommandIdHash(42)).toBe(stableCommandIdHash(42));
  });
});

describe('validateProposalBatch', () => {
  const verbs = ['git blame', 'git bisect', 'git checkout', 'git switch', 'git config', 'git revert', 'git reset'];
  const trainMisses = [
    {
      query: { command_id: 1, query_text: 'who wrote each line in the file' },
      judge: { reason: 'displayed recipe is not authorship inspection' },
    },
    {
      query: { command_id: 2, query_text: 'show who wrote this code line by line' },
      judge: { reason: 'wrong verb family' },
    },
  ];

  it('accepts a well-formed lexicon_trap', () => {
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'lexicon_trap',
            role: 'authorship_test',
            needles: ['who wrote'],
            prefer_verb: 'git blame',
            evidence_command_ids: [1, 2],
          },
        ],
      },
      { trainMisses, taxonomyVerbs: verbs },
    );
    expect(r.proposals).toHaveLength(1);
    expect(r.proposals[0].kind).toBe('lexicon_trap');
  });

  it('rejects displayed/wrong evidence ids and singleton without query generality', () => {
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'lexicon_trap',
            role: 'bad',
            needles: ['who wrote'],
            prefer_verb: 'git blame',
            evidence_command_ids: [1, 99],
          },
        ],
      },
      {
        trainMisses: [
          {
            query: { command_id: 1, query_text: 'who wrote each line' },
            judge: { reason: 'x' },
          },
        ],
        taxonomyVerbs: verbs,
      },
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.errors.some((e) => e.includes('not in train misses'))).toBe(true);
    expect(r.errors.some((e) => e.includes('≥2'))).toBe(true);
  });

  it('accepts trap with 1 train-miss id when ≥2 queries match needles', () => {
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'lexicon_trap',
            role: 'authorship_one_id',
            needles: ['who wrote'],
            prefer_verb: 'git blame',
            evidence_command_ids: [1],
          },
        ],
      },
      {
        trainMisses: [
          { query: { command_id: 1, query_text: 'who wrote file a' } },
          { query: { command_id: 1, query_text: 'who wrote file b' } },
        ],
        taxonomyVerbs: verbs,
      },
    );
    expect(r.proposals).toHaveLength(1);
    expect(trapEvidenceMeetsGenerality([1], ['who wrote'], [
      { query: { command_id: 1, query_text: 'who wrote file a' } },
      { query: { command_id: 1, query_text: 'who wrote file b' } },
    ]).via).toBe('queries');
  });

  it('rejects needle that copies judge reason', () => {
    expect(
      needleCopiesJudgeReason('displayed recipe is not authorship inspection', [
        'displayed recipe is not authorship inspection',
      ]),
    ).toBe(true);
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'lexicon_trap',
            role: 'copy',
            needles: ['displayed recipe is not authorship'],
            prefer_verb: 'git blame',
            evidence_command_ids: [1, 2],
          },
        ],
      },
      { trainMisses, taxonomyVerbs: verbs },
    );
    expect(r.proposals).toHaveLength(0);
  });

  it('accepts verb_family with taxonomy members', () => {
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'verb_family',
            canonical: 'git checkout',
            aliases: ['git switch'],
            evidence_command_ids: [1],
          },
        ],
      },
      { trainMisses, taxonomyVerbs: verbs },
    );
    expect(r.proposals).toHaveLength(1);
  });

  it('rejects forbidden destructive antonym families', () => {
    expect(isForbiddenVerbFamilyPair('git revert', 'git reset')).toBe(true);
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'verb_family',
            canonical: 'git revert',
            aliases: ['git reset'],
            evidence_command_ids: [1],
          },
        ],
      },
      { trainMisses, taxonomyVerbs: verbs },
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.errors.some((e) => e.includes('forbidden'))).toBe(true);
  });

  it('rejects families when goldens distinguish members (diff vs difftool)', () => {
    expect(queryMentionsVerb('show unstaged with git diff', 'git diff')).toBe(true);
    expect(queryMentionsVerb('show unstaged with git diff', 'git difftool')).toBe(false);
    expect(
      goldensDistinguishFamilyMembers(
        ['git diff', 'git difftool'],
        [
          { query_text: 'show unstaged changes in working tree with git diff' },
          {
            query_text:
              'show diff of working tree changes using difftool without prompting',
          },
        ],
      ),
    ).toBe(true);
    const r = validateProposalBatch(
      {
        proposals: [
          {
            kind: 'verb_family',
            canonical: 'git diff',
            aliases: ['git difftool'],
            evidence_command_ids: [1],
          },
        ],
      },
      {
        trainMisses,
        taxonomyVerbs: [...verbs, 'git diff', 'git difftool'],
        goldenBank: [
          { query_text: 'show unstaged changes in working tree with git diff' },
          {
            query_text:
              'show diff of working tree changes using difftool without prompting',
          },
        ],
      },
    );
    expect(r.proposals).toHaveLength(0);
    expect(r.errors.some((e) => e.includes('distinguish'))).toBe(true);
  });

  it('pruneDistinguishedEvalRoundFamilies drops eval_round only', () => {
    const { file, pruned } = pruneDistinguishedEvalRoundFamilies(
      {
        version: 1,
        families: [
          { canonical: 'git checkout', aliases: ['git switch'], source: 'seed' },
          {
            canonical: 'git diff',
            aliases: ['git difftool'],
            source: 'eval_round',
            evidence_command_ids: [7, 8],
          },
        ],
      },
      [
        { query_text: 'show unstaged with git diff' },
        { query_text: 'view with difftool without prompting' },
      ],
    );
    expect(pruned).toHaveLength(1);
    expect(file.families).toHaveLength(1);
    expect(file.families[0].canonical).toBe('git checkout');
  });
});

describe('accept / reject + taxonomy rollback', () => {
  let dir;
  let trapsPath;
  let familiesPath;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'eval-improve-'));
    trapsPath = path.join(dir, 'lexicon_traps.json');
    familiesPath = path.join(dir, 'verb_families.json');
    writeFileSync(
      trapsPath,
      JSON.stringify({ version: 1, traps: [] }, null, 2),
    );
    writeFileSync(
      familiesPath,
      JSON.stringify({ version: 1, families: [] }, null, 2),
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('shouldAcceptImproveRound requires holdout non-drop and absolute pass gain', () => {
    expect(
      shouldAcceptImproveRound({
        before: { passed: 10, hitPassed: 8 },
        after: { passed: 11, hitPassed: 8 },
        holdoutBefore: { total: 3, hitRate: 0.5, rate: 0.5 },
        holdoutAfter: { total: 3, hitRate: 0.5, rate: 0.5 },
      }),
    ).toBe(true);
    expect(
      shouldAcceptImproveRound({
        before: { passed: 10, hitPassed: 8 },
        after: { passed: 11, hitPassed: 9 },
        holdoutBefore: { total: 3, hitRate: 0.6, rate: 0.6 },
        holdoutAfter: { total: 3, hitRate: 0.3, rate: 0.6 },
      }),
    ).toBe(false);
    expect(
      shouldAcceptImproveRound({
        before: { passed: 10, hitPassed: 8 },
        after: { passed: 10, hitPassed: 9 },
        holdoutBefore: { total: 0, hitRate: 1, rate: 1 },
        holdoutAfter: { total: 0, hitRate: 1, rate: 1 },
      }),
    ).toBe(true);
  });

  it('apply + restore rolls back taxonomy JSON', () => {
    const applied = applyProposalsToTaxonomy(
      [
        {
          kind: 'lexicon_trap',
          role: 'tmp',
          needles: ['who wrote'],
          prefer_verb: 'git blame',
          evidence_command_ids: [1, 2],
        },
      ],
      { trapsPath, familiesPath },
    );
    expect(readLexiconTrapsFile({ trapsPath }).traps).toHaveLength(1);
    restoreTaxonomySnapshot(applied.previous, { trapsPath, familiesPath });
    expect(readLexiconTrapsFile({ trapsPath }).traps).toHaveLength(0);
  });

  it('metricsForCommandIds slices re-eval results', () => {
    const evalResult = {
      results: [
        { query: { command_id: 1 }, pass: true, via: 'hit@display' },
        { query: { command_id: 2 }, pass: false, via: 'miss' },
        { query: { command_id: 3 }, pass: true, via: 'judge' },
      ],
    };
    const m = metricsForCommandIds(evalResult, new Set([2, 3]));
    expect(m.total).toBe(2);
    expect(m.hitPassed).toBe(0);
    expect(m.passed).toBe(1);
  });
});

describe('maybeRunEvalImprove policy', () => {
  it('runs on gate fail and polish thresholds', () => {
    expect(shouldRunEvalImprove({ ok: false, results: [{ pass: false }] }).run).toBe(
      true,
    );
    expect(
      shouldRunEvalImprove({
        ok: true,
        rate: 0.96,
        results: Array.from({ length: 5 }, () => ({ pass: false })),
      }).reason,
    ).toBe('polish');
    expect(
      shouldRunEvalImprove({
        ok: true,
        rate: 0.99,
        results: [{ pass: false }, { pass: true }],
      }).run,
    ).toBe(false);
    expect(
      shouldRunEvalImprove(
        { ok: false, results: [{ pass: false }] },
        { skipEvalImprove: true },
      ).run,
    ).toBe(false);
  });

  it('countEvalMisses counts non-pass rows', () => {
    expect(
      countEvalMisses({
        results: [{ pass: true }, { pass: false }, { pass: false }],
      }),
    ).toBe(2);
  });

  it('mock Flash/Pro accept path updates evalResult', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-improve-round-'));
    const trapsPath = path.join(dir, 'lexicon_traps.json');
    const familiesPath = path.join(dir, 'verb_families.json');
    writeFileSync(trapsPath, JSON.stringify({ version: 1, traps: [] }));
    writeFileSync(familiesPath, JSON.stringify({ version: 1, families: [] }));
    const artDir = path.join(dir, 'arts');

    const before = {
      ok: false,
      okHit: true,
      okPass: false,
      passed: 1,
      hitPassed: 1,
      total: 3,
      rate: 1 / 3,
      hitRate: 1 / 3,
      results: [
        {
          pass: true,
          via: 'hit@display',
          query: { command_id: 1, query_text: 'ok' },
          displayed: [],
        },
        {
          pass: false,
          via: 'miss',
          query: {
            command_id: 2,
            query_text: 'switch to feature branch',
            primary_verb: 'git checkout',
          },
          displayed: [],
          judge: { utility: 0.2, reason: 'empty' },
        },
        {
          pass: false,
          via: 'miss',
          query: {
            command_id: 3,
            query_text: 'checkout the other branch',
            primary_verb: 'git checkout',
          },
          displayed: [],
          judge: { utility: 0.1, reason: 'empty' },
        },
      ],
    };

    const after = {
      ...before,
      ok: true,
      okPass: true,
      passed: 2,
      rate: 2 / 3,
      results: before.results.map((r, i) =>
        i === 1 ? { ...r, pass: true, via: 'judge' } : r,
      ),
    };

    let llmCalls = 0;
    const out = await maybeRunEvalImprove({
      phase: 'test',
      evalResult: before,
      stagingPath: path.join(dir, 'unused.db'),
      embedder: { embed: async () => new Float32Array(384) },
      bank: [],
      trapsPath,
      familiesPath,
      artifactsDir: artDir,
      taxonomyVerbs: ['git checkout', 'git switch'],
      goldenBank: [],
      runBankEval: async () => after,
      llmJsonObject: async ({ schema }) => {
        llmCalls += 1;
        if (schema?.shape?.clusters) {
          return {
            clusters: [
              {
                label: 'checkout',
                pattern: 'branch switch synonym',
                example_queries: ['switch to feature branch'],
                command_ids: [2, 3],
              },
            ],
          };
        }
        return {
          proposals: [
            {
              kind: 'verb_family',
              canonical: 'git checkout',
              aliases: ['git switch'],
              evidence_command_ids: [2],
            },
          ],
        };
      },
    });

    expect(llmCalls).toBeGreaterThanOrEqual(2);
    expect(out.ran).toBe(true);
    expect(out.improve?.accepted).toBe(true);
    expect(out.evalResult.passed).toBe(2);
    expect(readVerbFamiliesFile({ familiesPath }).families).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('mock re-eval discard restores taxonomy', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'eval-improve-reject-'));
    const trapsPath = path.join(dir, 'lexicon_traps.json');
    const familiesPath = path.join(dir, 'verb_families.json');
    writeFileSync(trapsPath, JSON.stringify({ version: 1, traps: [] }));
    writeFileSync(familiesPath, JSON.stringify({ version: 1, families: [] }));

    const before = {
      ok: false,
      okHit: true,
      okPass: false,
      passed: 2,
      hitPassed: 2,
      total: 4,
      rate: 0.5,
      hitRate: 0.5,
      results: [
        {
          pass: false,
          via: 'miss',
          query: { command_id: 10, query_text: 'who wrote line a' },
          judge: { utility: 0.1, reason: 'x' },
        },
        {
          pass: false,
          via: 'miss',
          query: { command_id: 11, query_text: 'who wrote line b' },
          judge: { utility: 0.1, reason: 'y' },
        },
        {
          pass: false,
          via: 'miss',
          query: { command_id: 12, query_text: 'who wrote line c' },
          judge: { utility: 0.1, reason: 'z' },
        },
        {
          pass: true,
          via: 'hit@display',
          query: { command_id: 13, query_text: 'ok' },
        },
      ],
    };

    const after = {
      ...before,
      passed: 1,
      hitPassed: 1,
      rate: 0.25,
      hitRate: 0.25,
      results: before.results.map((r, i) =>
        i === 3 ? { ...r, pass: false, via: 'miss' } : r,
      ),
    };

    const out = await maybeRunEvalImprove({
      phase: 'test',
      evalResult: before,
      stagingPath: path.join(dir, 'unused.db'),
      embedder: { embed: async () => new Float32Array(384) },
      bank: [],
      trapsPath,
      familiesPath,
      artifactsDir: path.join(dir, 'arts'),
      taxonomyVerbs: ['git blame', 'git annotate'],
      goldenBank: [],
      runBankEval: async () => after,
      llmJsonObject: async ({ schema }) => {
        if (schema?.shape?.clusters) {
          return { clusters: [] };
        }
        return {
          proposals: [
            {
              kind: 'verb_family',
              canonical: 'git blame',
              aliases: ['git annotate'],
              evidence_command_ids: [10],
            },
          ],
        };
      },
    });

    expect(out.improve?.accepted).toBe(false);
    expect(out.evalResult.passed).toBe(2);
    expect(readVerbFamiliesFile({ familiesPath }).families).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
