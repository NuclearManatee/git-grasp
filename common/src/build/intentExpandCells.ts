// @ts-nocheck
/**
 * Matrix cell coverage state for iterative intent expand.
 * Each skill × category cell is filled | skipped | empty.
 */
import { SKILL_LEVELS, INTENT_CATEGORIES } from '../lib/skills.js';
import { cellKey } from '../schemas/intentMatrix.js';

/** @typedef {'filled' | 'skipped' | 'empty'} CellStatus */

/**
 * @returns {{ skill_level: string, intent_category: string, key: string }[]}
 */
export function allMatrixCells() {
  /** @type {{ skill_level: string, intent_category: string, key: string }[]} */
  const out = [];
  for (const skill_level of SKILL_LEVELS) {
    for (const intent_category of INTENT_CATEGORIES) {
      out.push({
        skill_level,
        intent_category,
        key: cellKey(skill_level, intent_category),
      });
    }
  }
  return out;
}

/**
 * @returns {Map<string, { status: CellStatus, reason?: string }>}
 */
export function createCellState() {
  const map = new Map();
  for (const cell of allMatrixCells()) {
    map.set(cell.key, { status: 'empty' });
  }
  return map;
}

/**
 * @param {Map<string, { status: CellStatus, reason?: string }>} state
 * @param {string} skill_level
 * @param {string} intent_category
 */
export function markFilled(state, skill_level, intent_category) {
  const key = cellKey(skill_level, intent_category);
  if (!state.has(key)) return;
  state.set(key, { status: 'filled' });
}

/**
 * @param {Map<string, { status: CellStatus, reason?: string }>} state
 * @param {string} skill_level
 * @param {string} intent_category
 * @param {string} [reason]
 */
export function markSkipped(state, skill_level, intent_category, reason = '') {
  const key = cellKey(skill_level, intent_category);
  const cur = state.get(key);
  if (!cur || cur.status === 'filled') return;
  state.set(key, { status: 'skipped', reason: String(reason || '').trim() });
}

/**
 * @param {Map<string, { status: CellStatus, reason?: string }>} state
 * @returns {{ skill_level: string, intent_category: string, key: string }[]}
 */
export function emptyCells(state) {
  return allMatrixCells().filter((c) => state.get(c.key)?.status === 'empty');
}

/**
 * @param {Map<string, { status: CellStatus, reason?: string }>} state
 */
export function allDecided(state) {
  for (const v of state.values()) {
    if (v.status === 'empty') return false;
  }
  return true;
}

/**
 * @param {Map<string, { status: CellStatus, reason?: string }>} state
 */
export function cellCoverageStats(state) {
  let filled = 0;
  let skipped = 0;
  let empty = 0;
  for (const v of state.values()) {
    if (v.status === 'filled') filled += 1;
    else if (v.status === 'skipped') skipped += 1;
    else empty += 1;
  }
  return { filled, skipped, empty, total: state.size };
}

/**
 * Format empty cells for the expand prompt.
 * @param {{ skill_level: string, intent_category: string }[]} cells
 */
export function formatEmptyCellsForPrompt(cells) {
  if (!cells.length) return '(none)';
  return cells.map((c) => `- ${c.skill_level} × ${c.intent_category}`).join('\n');
}
