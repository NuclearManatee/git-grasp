// @ts-nocheck
import { describe, expect, it } from 'vitest';
import {
  cheapPlausibilityCheck,
  validateRecipeCandidate,
} from '../../../common/src/build/recipeValidate.ts';
import { commandFingerprint } from '../../../common/src/db/schema.ts';
import {
  isDiscoveryBatchFlat,
} from '../../../common/src/build/leafSaturate.ts';
import { heldoutAccuracy } from '../../../common/src/build/leafHoldout.ts';
import {
  clusterGapQueries,
  classifyMissHeuristic,
} from '../../../common/src/build/improveTriage.ts';
import {
  addRegressionQueries,
  evaluateRegressionSet,
} from '../../../common/src/build/regressionSet.ts';
import { recipeFtsBody } from '../../../common/src/search/ftsQuery.ts';

describe('cheapPlausibilityCheck', () => {
  it('accepts a simple git recipe', () => {
    const r = cheapPlausibilityCheck({
      title: 'Show status',
      description: 'See working tree status',
      commands: [{ command: 'git status' }],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects shell metacharacters', () => {
    const r = cheapPlausibilityCheck({
      title: 'Bad',
      description: 'Bad',
      commands: [{ command: 'git status && git log' }],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('shell_meta');
  });
});

describe('validateRecipeCandidate gate order', () => {
  it('fails cheap before LLM when description missing', async () => {
    const res = await validateRecipeCandidate(
      {
        title: 'x',
        description: '',
        commands: [{ command: 'git status' }],
      },
      { skipSandbox: true, skipJudge: true, skipBackTranslate: true, skipLlmPlausibility: true, maxRegen: 0 },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('missing_description');
  });

  it('accepts when all expensive gates skipped', async () => {
    const res = await validateRecipeCandidate(
      {
        title: 'Show status',
        description: 'Inspect the working tree',
        commands: [{ command: 'git status' }],
        initial_state: '',
      },
      {
        skipSandbox: true,
        skipJudge: true,
        skipBackTranslate: true,
        skipLlmPlausibility: true,
        maxRegen: 0,
      },
    );
    expect(res.ok).toBe(true);
    expect(res.recipe.validated).toBe(true);
    expect(res.recipe.command_fingerprint).toBeTruthy();
  });
});

describe('commandFingerprint', () => {
  it('normalizes placeholders', () => {
    const a = commandFingerprint([{ command: 'git checkout <branch>' }]);
    const b = commandFingerprint([{ command: 'git checkout <name>' }]);
    expect(a).toBe(b);
  });
});

describe('discovery + holdout helpers', () => {
  it('detects flat batches', () => {
    expect(isDiscoveryBatchFlat(0, 8)).toBe(true);
    expect(isDiscoveryBatchFlat(4, 8)).toBe(false);
  });

  it('computes heldout accuracy', () => {
    expect(
      heldoutAccuracy([
        { hit: true },
        { hit: true },
        { hit: false },
      ]),
    ).toBeCloseTo(2 / 3);
  });
});

describe('improve triage helpers', () => {
  it('clusters gap queries', () => {
    const emb = (n) => new Float32Array(Array(8).fill(n));
    const items = [
      { query: 'a', embedding: emb(1) },
      { query: 'b', embedding: emb(1) },
      { query: 'c', embedding: emb(1) },
      { query: 'd', embedding: emb(0) },
    ];
    const clusters = clusterGapQueries(items, { threshold: 0.99, minSize: 3 });
    expect(clusters.length).toBe(1);
    expect(clusters[0]).toHaveLength(3);
  });

  it('heuristic buckets', () => {
    expect(classifyMissHeuristic({ correctExists: true, hit: false }).bucket).toBe(1);
    expect(classifyMissHeuristic({ leafId: 'x' }).bucket).toBe(2);
    expect(classifyMissHeuristic({}).bucket).toBe(3);
  });
});

describe('regression set', () => {
  it('evaluates against search stub', async () => {
    let set = { version: 0, queries: [] };
    set = addRegressionQueries(set, [
      { query: 'undo commit', recipe_id: 'r1', source: 'synthetic' },
    ]);
    const evaled = await evaluateRegressionSet(set, {
      minAccuracy: 1,
      search: async () => ({ displayResults: [{ command_id: 'r1' }] }),
    });
    expect(evaled.ok).toBe(true);
  });
});

describe('recipeFtsBody', () => {
  it('includes title description tags and commands', () => {
    const body = recipeFtsBody([{ command: 'git status', comment: 'st' }], {
      title: 'Status',
      description: 'Show status',
      tags: ['inspect'],
    });
    expect(body).toContain('Status');
    expect(body).toContain('Show status');
    expect(body).toContain('inspect');
    expect(body).toContain('git status');
  });
});
