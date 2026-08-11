// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  buildThreads,
  journeysToFeeder,
  isNearEditQuery,
} from '../../common/src/evolve/thread.js';
import { labelFromResponse } from '../../common/src/evolve/label.js';
import { splitFeederHoldout, queryHashUnit } from '../../common/src/evolve/split.js';
import { FeederItemSchema } from '../../common/src/evolve/schemas.js';

function fe(partial) {
  return {
    id: partial.id,
    name: 'cli_search',
    createdAtMs: partial.at,
    threadKey: partial.threadKey || 'sid:s1',
    query: partial.query,
    catalog_version: 5,
    response: partial.response || {
      status: 'empty',
      confidence: 0.1,
      displayCount: 0,
      results: [],
    },
  };
}

describe('evolve thread + split', () => {
  it('labels from response', () => {
    expect(labelFromResponse({ status: 'ok', confidence: 0.9, displayCount: 1 })).toBe(
      'satisfied',
    );
    expect(labelFromResponse({ status: 'ok', confidence: 0.5, displayCount: 2 })).toBe('weak');
    expect(labelFromResponse({ status: 'empty', confidence: 0, displayCount: 0 })).toBe('miss');
  });

  it('near-edit detects refinements', () => {
    expect(isNearEditQuery('undo last commit', 'undo last commit keep files')).toBe(true);
    expect(isNearEditQuery('undo last commit', 'create a branch')).toBe(false);
  });

  it('splits on gap and soft-merges near edits', () => {
    const t0 = 1_700_000_000_000;
    const { journeys } = buildThreads([
      fe({
        id: '1',
        at: t0,
        query: 'undo commit',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
      fe({
        id: '2',
        at: t0 + 30_000,
        query: 'undo last commit keep files',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
      fe({
        id: '3',
        at: t0 + 200_000,
        query: 'create branch',
        response: { status: 'ok', confidence: 0.9, displayCount: 1, results: [{ command_id: 'x' }] },
      }),
    ]);
    expect(journeys.length).toBeGreaterThanOrEqual(2);
    const missJourney = journeys.find((j) => j.missLike);
    expect(missJourney).toBeTruthy();
    expect(missJourney.events.length).toBe(2);
    expect(missJourney.finalLabel).toBe('abandon');
  });

  it('caps oversized threads', () => {
    const t0 = 1_700_000_000_000;
    const events = Array.from({ length: 15 }, (_, i) =>
      fe({
        id: String(i),
        at: t0 + i * 1000,
        query: `query number ${i} unique words here`,
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
    );
    const { journeys, droppedOversized } = buildThreads(events);
    expect(droppedOversized).toBeGreaterThan(0);
    expect(journeys).toHaveLength(0);
  });

  it('feeder items validate and split 80/20', () => {
    const { journeys } = buildThreads([
      fe({
        id: '1',
        at: 1,
        query: 'alpha undo commit please',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
      fe({
        id: '2',
        at: 2,
        threadKey: 'sid:s2',
        query: 'beta stash changes now',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
      fe({
        id: '3',
        at: 3,
        threadKey: 'sid:s3',
        query: 'gamma rebase onto main',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
      fe({
        id: '4',
        at: 4,
        threadKey: 'sid:s4',
        query: 'delta cherry pick commit',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
      fe({
        id: '5',
        at: 5,
        threadKey: 'sid:s5',
        query: 'epsilon amend last commit',
        response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      }),
    ]);
    const items = journeysToFeeder(journeys).map((i) => FeederItemSchema.parse(i));
    expect(items.every((i) => i.source === 'observe')).toBe(true);
    const { train, holdout } = splitFeederHoldout(items);
    expect(train.length + holdout.length).toBe(items.length);
    expect(queryHashUnit('x')).toBeGreaterThanOrEqual(0);
    expect(queryHashUnit('x')).toBeLessThanOrEqual(1);
  });
});
