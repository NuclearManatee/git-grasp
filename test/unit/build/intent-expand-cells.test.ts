import { describe, expect, it } from 'vitest';
import {
  allDecided,
  allMatrixCells,
  cellCoverageStats,
  createCellState,
  emptyCells,
  formatEmptyCellsForPrompt,
  markFilled,
  markSkipped,
} from '../../../common/src/build/intentExpandCells.ts';

describe('intentExpandCells', () => {
  it('initializes 16 empty cells', () => {
    const state = createCellState();
    expect(allMatrixCells()).toHaveLength(16);
    expect(state.size).toBe(16);
    expect(emptyCells(state)).toHaveLength(16);
    expect(allDecided(state)).toBe(false);
    expect(cellCoverageStats(state)).toEqual({
      filled: 0,
      skipped: 0,
      empty: 16,
      total: 16,
    });
  });

  it('markFilled and markSkipped transitions; empty list shrinks', () => {
    const state = createCellState();
    markFilled(state, 'beginner', 'goal');
    markSkipped(state, 'expert', 'error_message', 'no realistic error');
    expect(emptyCells(state)).toHaveLength(14);
    expect(cellCoverageStats(state)).toEqual({
      filled: 1,
      skipped: 1,
      empty: 14,
      total: 16,
    });
  });

  it('does not overwrite filled with skip; fill is idempotent', () => {
    const state = createCellState();
    markFilled(state, 'beginner', 'goal');
    markSkipped(state, 'beginner', 'goal', 'should ignore');
    markFilled(state, 'beginner', 'goal');
    expect(cellCoverageStats(state).filled).toBe(1);
    expect(cellCoverageStats(state).skipped).toBe(0);
  });

  it('allDecided when every cell filled or skipped', () => {
    const state = createCellState();
    for (const c of allMatrixCells()) {
      if (c.skill_level === 'expert') markSkipped(state, c.skill_level, c.intent_category, 'n/a');
      else markFilled(state, c.skill_level, c.intent_category);
    }
    expect(allDecided(state)).toBe(true);
    expect(emptyCells(state)).toHaveLength(0);
  });

  it('formats empty cells for prompt', () => {
    expect(formatEmptyCellsForPrompt([])).toBe('(none)');
    expect(formatEmptyCellsForPrompt([{ skill_level: 'beginner', intent_category: 'goal' }])).toContain(
      'beginner × goal',
    );
  });
});
