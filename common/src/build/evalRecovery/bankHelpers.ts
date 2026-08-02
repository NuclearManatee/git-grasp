// @ts-nocheck
/**
 * Golden bank snapshot / apply / rollback for eval gate recovery (bank-only).
 */
import { loadBank, writeBank } from '../evalGate.js';
import {
  EVAL_GATE_FAIL_BANK_SIZE_FLOOR,
  EVAL_GATE_POLISH_BANK_SIZE_FLOOR,
} from '../../db/constants.js';

export function snapshotGoldenBank() {
  return loadBank('golden.jsonl').map((r) => ({ ...r }));
}

export function restoreGoldenBank(rows) {
  writeBank('golden.jsonl', rows || []);
}

/**
 * Apply rewrite/drop actions to golden bank.
 * @param {{ command_id: number, op: 'rewrite'|'drop', query_text?: string }[]} actions
 * @param {{ mode?: 'fail'|'polish', allowDrop?: boolean }} [opts]
 * @returns {{ ok: boolean, reason?: string, before: object[], after: object[], dropped: number, rewritten: number }}
 */
export function applyGoldenActions(actions, opts = {}) {
  const before = snapshotGoldenBank();
  const mode = opts.mode || 'fail';
  const allowDrop = opts.allowDrop !== false;
  const byId = new Map();
  for (const a of actions || []) {
    byId.set(Number(a.command_id), a);
  }

  let dropped = 0;
  let rewritten = 0;
  const after = [];
  for (const row of before) {
    const id = Number(row.command_id);
    const act = byId.get(id);
    if (!act) {
      after.push(row);
      continue;
    }
    if (act.op === 'drop') {
      if (!allowDrop) {
        after.push(row);
        continue;
      }
      dropped += 1;
      continue;
    }
    if (act.op === 'rewrite' && act.query_text) {
      after.push({ ...row, query_text: String(act.query_text).trim() });
      rewritten += 1;
      continue;
    }
    after.push(row);
  }

  const floor =
    mode === 'polish' ? EVAL_GATE_POLISH_BANK_SIZE_FLOOR : EVAL_GATE_FAIL_BANK_SIZE_FLOOR;
  const minSize = Math.ceil(before.length * floor);
  if (after.length < minSize) {
    return {
      ok: false,
      reason: `bank_size_floor:${after.length}<${minSize}`,
      before,
      after: before,
      dropped,
      rewritten,
    };
  }

  // Polish: drop-only that exceeds (1-floor) → no-op
  if (mode === 'polish' && rewritten === 0 && dropped > 0) {
    const cut = dropped / Math.max(1, before.length);
    if (cut > 1 - floor + 1e-9) {
      return {
        ok: false,
        reason: 'polish_drop_only_exceeds_floor',
        before,
        after: before,
        dropped,
        rewritten,
      };
    }
  }

  writeBank('golden.jsonl', after);
  return { ok: true, before, after, dropped, rewritten };
}

export function bankSizeFloorOk(beforeLen, afterLen, mode) {
  const floor =
    mode === 'polish' ? EVAL_GATE_POLISH_BANK_SIZE_FLOOR : EVAL_GATE_FAIL_BANK_SIZE_FLOOR;
  return afterLen + 1e-9 >= beforeLen * floor;
}
