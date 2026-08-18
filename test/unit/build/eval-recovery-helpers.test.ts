import { describe, expect, it } from 'bun:test';
import {
  queryGitVerbs,
  recipeVerbSet,
  recipeCoversVerbs,
  buildRecipeVerbCoverage,
  stagingCoversVerbSet,
} from '../../../common/src/build/evalRecovery/coverageHelpers.ts';
import {
  MISS_CLASSES,
  classifyMiss,
  classifyEvalMisses,
  partitionByClass,
  needsBankRewrite,
  needsImproveRound,
  needsCoverageGeneration,
} from '../../../common/src/build/evalRecovery/classifyMisses.ts';

const familyIndex = new Map([
  ['git revert', new Set(['git revert'])],
  ['git reset', new Set(['git reset', 'git clean'])],
  ['git status', new Set(['git status'])],
  ['git add', new Set(['git add'])],
  ['git commit', new Set(['git commit'])],
]);

describe('coverageHelpers', () => {
  it('extracts query verbs and recipe coverage', () => {
    expect(queryGitVerbs('git repository then git status')).toEqual(['git status']);
    expect(queryGitVerbs('git status and git add', { knownVerbs: ['git status'] })).toEqual([
      'git status',
    ]);
    const verbs = recipeVerbSet({ commands: [{ command: 'git add f' }, { command: 'git commit -m x' }] });
    expect(verbs.has('git add')).toBe(true);
    expect(recipeCoversVerbs(verbs, ['git add', 'git commit'])).toBe(true);
    expect(recipeCoversVerbs(['git add'], ['git commit'])).toBe(false);
    const coverage = buildRecipeVerbCoverage([
      { row_id: 1, command_recipe: { commands: [{ command: 'git status' }] }, mutation_kind: 'state' },
    ]);
    expect(stagingCoversVerbSet(coverage, ['git status'])).toBe(true);
    expect(stagingCoversVerbSet(coverage, [])).toBe(true);
    expect(stagingCoversVerbSet([], ['git status'])).toBe(false);
  });
});

describe('classifyMisses', () => {
  const opts = { familyIndex };

  it('classifies miss buckets', () => {
    expect(classifyMiss({ pass: true }, opts)).toBe('other');
    expect(classifyMiss({ pass: false, displayed: [] }, opts)).toBe('retrieval_sibling');
    expect(
      classifyMiss(
        {
          pass: false,
          query: { primary_verb: 'git revert', query_text: 'undo commit' },
          displayed: [{ example: 'git reset --hard' }],
        },
        opts,
      ),
    ).toBe('destructive_alt');
    expect(
      classifyMiss(
        {
          pass: false,
          query: { query_text: 'git add and git commit', primary_verb: 'git add' },
          displayed: [{ example: 'git status' }],
        },
        { ...opts, recipeVerbCoverage: [] },
      ),
    ).toBe('coverage_gap');
    expect(
      classifyMiss(
        {
          pass: false,
          query: { primary_verb: 'git status', query_text: 'show status' },
          displayed: [{ example: 'git commit' }],
        },
        opts,
      ),
    ).toBe('retrieval_sibling');
    expect(
      classifyMiss(
        {
          pass: false,
          query: {
            primary_verb: 'git add',
            query_text: 'git add then git commit',
            mutation_kind: 'composition',
          },
          displayed: [{ example: 'git add f' }],
        },
        opts,
      ),
    ).toBe('retrieval_sibling');
    expect(
      classifyMiss(
        {
          pass: false,
          query: {
            primary_verb: 'git add',
            query_text: 'git add then git commit',
            mutation_kind: 'flag',
          },
          displayed: [{ example: 'git add f' }],
        },
        opts,
      ),
    ).toBe('over_ask');
    expect(
      classifyMiss(
        {
          pass: false,
          query: { primary_verb: 'git add', query_text: 'git add then git commit' },
          displayed: [{ example: 'git add f' }],
        },
        opts,
      ),
    ).toBe('partial_multistep');
    expect(
      classifyMiss(
        {
          pass: false,
          via: 'ko',
          utility: 0.2,
          query: { primary_verb: 'git status', query_text: 'status' },
          displayed: [{ example: 'git status' }],
        },
        opts,
      ),
    ).toBe('partial_multistep');
    expect(MISS_CLASSES).toContain('other');
  });

  it('partitions classified misses', () => {
    const classified = classifyEvalMisses(
      [
        { pass: true },
        { via: 'skipped' },
        {
          pass: false,
          query: { primary_verb: 'git status', query_text: 'status', command_id: 3 },
          displayed: [{ example: 'git commit' }],
        },
      ],
      opts,
    );
    const parts = partitionByClass(classified);
    expect(parts.retrieval_sibling.length).toBe(1);
    expect(needsImproveRound(classified)).toBe(true);
    expect(needsBankRewrite(classified)).toBe(false);
    expect(needsCoverageGeneration(classified)).toBe(false);
    expect(needsBankRewrite([{ class: 'over_ask' }])).toBe(true);
    expect(needsCoverageGeneration([{ class: 'coverage_gap' }])).toBe(true);
    expect(partitionByClass([{ class: 'nope' }]).other).toHaveLength(1);
  });
});
