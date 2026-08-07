import { describe, expect, it } from 'vitest';
import {
  recordFloorMetAtIter,
  shouldStopAfterPostFloorBudget,
} from '../../../common/src/build/loopBudget.ts';

describe('recordFloorMetAtIter', () => {
  it('stays null until floors pass', () => {
    expect(recordFloorMetAtIter(null, false, 1)).toBe(null);
    expect(recordFloorMetAtIter(undefined, false, 2)).toBe(null);
  });

  it('records the first iteration floors pass', () => {
    expect(recordFloorMetAtIter(null, true, 3)).toBe(3);
  });

  it('is sticky once set', () => {
    expect(recordFloorMetAtIter(3, true, 5)).toBe(3);
    expect(recordFloorMetAtIter(3, false, 6)).toBe(3);
  });
});

describe('shouldStopAfterPostFloorBudget', () => {
  it('is disabled when postFloorIterations is unset', () => {
    expect(
      shouldStopAfterPostFloorBudget({
        iteration: 99,
        floorMetAtIter: 1,
        postFloorIterations: null,
      }).stop,
    ).toBe(false);
    expect(
      shouldStopAfterPostFloorBudget({
        iteration: 99,
        floorMetAtIter: 1,
        postFloorIterations: undefined,
      }).stop,
    ).toBe(false);
  });

  it('does not stop before floors are met', () => {
    expect(
      shouldStopAfterPostFloorBudget({
        iteration: 5,
        floorMetAtIter: null,
        postFloorIterations: 2,
      }).stop,
    ).toBe(false);
  });

  it('allows n more full iterations after the floor-met one', () => {
    // floor met at 3, budget 5 → stop after iter 8
    expect(
      shouldStopAfterPostFloorBudget({
        iteration: 7,
        floorMetAtIter: 3,
        postFloorIterations: 5,
      }).stop,
    ).toBe(false);
    const stop = shouldStopAfterPostFloorBudget({
      iteration: 8,
      floorMetAtIter: 3,
      postFloorIterations: 5,
    });
    expect(stop.stop).toBe(true);
    expect(stop.floorMetAtIter).toBe(3);
    expect(stop.ranMore).toBe(5);
  });

  it('stops immediately when budget is 0 (no post-floor iters)', () => {
    const stop = shouldStopAfterPostFloorBudget({
      iteration: 4,
      floorMetAtIter: 4,
      postFloorIterations: 0,
    });
    expect(stop.stop).toBe(true);
    expect(stop.ranMore).toBe(0);
  });
});
