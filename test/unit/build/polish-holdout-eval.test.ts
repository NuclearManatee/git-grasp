// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import {
  heldoutAccuracy,
  runLeafHoldout,
} from '../../../common/src/build/leafHoldout.ts';
import {
  hitAtDisplay,
  recipeIdOf,
} from '../../../common/src/build/evalGate.ts';
import { assertV9IntentQuarantine } from '../../../common/src/build/evalQuarantine.ts';
import { reexpandIntentsForStaging } from '../../../common/src/build/evalImprove/reexpandIntents.ts';

describe('leafHoldout', () => {
  test('heldoutAccuracy', () => {
    expect(heldoutAccuracy([{ hit: true }, { hit: false }, { hit: true }])).toBeCloseTo(2 / 3);
  });

  test('thin LLM drafts do not count as pass rounds', async () => {
    const recipes = [{ id: 'r-a' }, { id: 'r-b' }];
    const out = await runLeafHoldout(
      { id: 'leaf', name: 'L', description: 'd' },
      {
        recipes,
        count: 4,
        passRounds: 1,
        minAccuracy: 0.5,
        llmJsonObject: async () => ({ queries: ['only one'] }),
        search: async () => ({ displayResults: [{ command_id: 'r-a' }], results: [] }),
      },
    );
    expect(out.ok).toBe(false);
    expect(out.rounds.some((r) => r.reason === 'thin_queries')).toBe(true);
  });

  test('misses omit expectedId; hits set verified id', async () => {
    const recipes = [{ id: 'r-a' }];
    const out = await runLeafHoldout(
      { id: 'leaf', name: 'L', description: 'd' },
      {
        recipes,
        count: 2,
        passRounds: 1,
        minAccuracy: 1,
        frozenQueries: ['q1', 'q2'],
        search: async (q) =>
          q === 'q1'
            ? { displayResults: [{ command_id: 'r-a' }], results: [] }
            : { displayResults: [{ command_id: 'other' }], results: [] },
      },
    );
    const results = out.rounds[0].results;
    expect(results[0].hit).toBe(true);
    expect(results[0].expectedId).toBe('r-a');
    expect(results[1].hit).toBe(false);
    expect(results[1].expectedId).toBeUndefined();
  });
});

describe('eval string ids + quarantine', () => {
  test('recipeIdOf / hitAtDisplay with string ids', () => {
    expect(recipeIdOf({ command_id: 'r-status' })).toBe('r-status');
    expect(
      hitAtDisplay({ displayResults: [{ command_id: 'r-status' }] }, 'r-status'),
    ).toBe(true);
    expect(
      hitAtDisplay({ displayResults: [{ command_id: 'r-status' }] }, 'r-other'),
    ).toBe(false);
  });

  test('reexpandIntentsForStaging throws quarantine', async () => {
    expect(() => assertV9IntentQuarantine()).toThrow(/schema v9/);
    await expect(reexpandIntentsForStaging({}, {})).rejects.toThrow(/schema v9/);
  });
});
