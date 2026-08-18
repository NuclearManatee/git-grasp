import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import {
  benchEnabled,
  benchBegin,
  benchMark,
  benchEnd,
  benchStoreLast,
  benchTakeLast,
} from '../../../common/src/search/benchTiming.ts';

describe('benchTiming', () => {
  const prev = process.env.GIT_GRASP_BENCH;

  beforeEach(() => {
    delete process.env.GIT_GRASP_BENCH;
    benchBegin();
    benchTakeLast();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.GIT_GRASP_BENCH;
    else process.env.GIT_GRASP_BENCH = prev;
  });

  it('no-ops when disabled', () => {
    expect(benchEnabled()).toBe(false);
    benchBegin();
    benchMark('embed');
    expect(benchEnd()).toBeNull();
    expect(benchTakeLast()).toBeNull();
  });

  it('records phases when enabled', () => {
    process.env.GIT_GRASP_BENCH = '1';
    expect(benchEnabled()).toBe(true);
    benchBegin();
    benchMark('embed');
    benchMark('knn');
    const breakdown = benchEnd();
    expect(breakdown).toBeTruthy();
    expect(breakdown.phases.embed).toBeGreaterThanOrEqual(0);
    benchStoreLast(breakdown);
    expect(benchTakeLast()).toEqual(breakdown);
    expect(benchTakeLast()).toBeNull();
  });
});
