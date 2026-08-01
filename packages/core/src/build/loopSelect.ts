/**
 * Pure parent selection for multi-axis evolve (no bun:sqlite).
 */
import { LOOP_MAX_BATCH } from '../db/constants.js';
import {
  buildVerbCoverage,
  leafPriorityScore,
  assignMutationKind,
} from './coverage.js';

function listLeaves(all) {
  const childParents = new Set(
    all.map((r) => r.parent_row_id).filter((x) => x != null),
  );
  const leaves = all.filter((r) => !childParents.has(r.row_id));
  return leaves.length ? leaves : all;
}

/**
 * Undersampled leaves with assigned mutation_kind (pure; no DB).
 * @param {object[]} all
 * @param {number} [limit]
 * @param {{ coverage?: object }} [opts]
 */
export function selectEvolutionParentsFromRows(all, limit = LOOP_MAX_BATCH, opts = {}) {
  const leaves = listLeaves(all);
  const coverage = opts.coverage || buildVerbCoverage(all);

  const scored = leaves
    .map((row) => ({
      row,
      priority: leafPriorityScore(row, coverage),
      risk: Number(row.risk) || 0,
      mutation_kind: assignMutationKind(row, coverage),
    }))
    .sort((a, b) => a.priority - b.priority || a.risk - b.risk || a.row.row_id - b.row.row_id);

  const cap = Math.min(limit, scored.length);
  const pool = scored.slice(0, Math.max(cap * 3, cap));
  const byRisk = [...pool].sort((a, b) => a.risk - b.risk);
  const thirds = [
    byRisk.slice(0, Math.ceil(byRisk.length / 3)),
    byRisk.slice(Math.ceil(byRisk.length / 3), Math.ceil((2 * byRisk.length) / 3)),
    byRisk.slice(Math.ceil((2 * byRisk.length) / 3)),
  ];

  const out = [];
  const seen = new Set();
  let i = 0;
  while (out.length < cap && i < pool.length + 3) {
    for (const bucket of thirds) {
      if (out.length >= cap) break;
      const idx = Math.floor(i / 3);
      const item = bucket[idx];
      if (!item || seen.has(item.row.row_id)) continue;
      seen.add(item.row.row_id);
      out.push({ ...item.row, mutation_kind: item.mutation_kind });
    }
    i += 1;
  }

  for (const item of scored) {
    if (out.length >= cap) break;
    if (seen.has(item.row.row_id)) continue;
    seen.add(item.row.row_id);
    out.push({ ...item.row, mutation_kind: item.mutation_kind });
  }

  return out;
}

export { listLeaves };
