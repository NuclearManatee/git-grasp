// @ts-nocheck
/**
 * Stable 70/30 train/holdout split by command_id.
 */

/**
 * Deterministic 32-bit hash for command ids (stable across runs).
 * @param {number|string} commandId
 */
export function stableCommandIdHash(commandId) {
  const s = String(commandId);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Assign each unique command_id to train (~70%) or holdout (~30%).
 * @param {object[]} misses rows with query.command_id
 * @param {{ trainRatio?: number }} [opts]
 */
export function splitTrainHoldoutByCommandId(misses, opts = {}) {
  const trainRatio = opts.trainRatio ?? 0.7;
  const byId = new Map();
  for (const m of misses || []) {
    const raw = m?.query?.command_id ?? m?.query?.recipe_id;
    if (raw == null || raw === '') continue;
    const id = String(raw);
    // Drop legacy NaN-from-Number coercion path; keep numeric and string recipe ids.
    if (id === 'NaN') continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(m);
  }
  const train = [];
  const holdout = [];
  const trainIds = new Set();
  const holdoutIds = new Set();
  const ids = [...byId.keys()].sort((a, b) => String(a).localeCompare(String(b)));
  for (const id of ids) {
    const intoTrain = (stableCommandIdHash(id) % 1000) / 1000 < trainRatio;
    const rows = byId.get(id);
    if (intoTrain) {
      trainIds.add(id);
      train.push(...rows);
    } else {
      holdoutIds.add(id);
      holdout.push(...rows);
    }
  }
  // If everything landed in one bucket, force at least one holdout id when possible.
  if (ids.length >= 2 && (holdoutIds.size === 0 || trainIds.size === 0)) {
    const moveId = ids[ids.length - 1];
    const rows = byId.get(moveId);
    if (holdoutIds.size === 0) {
      holdoutIds.add(moveId);
      trainIds.delete(moveId);
      for (const r of rows) {
        const i = train.indexOf(r);
        if (i >= 0) train.splice(i, 1);
        holdout.push(r);
      }
    } else {
      trainIds.add(moveId);
      holdoutIds.delete(moveId);
      for (const r of rows) {
        const i = holdout.indexOf(r);
        if (i >= 0) holdout.splice(i, 1);
        train.push(r);
      }
    }
  }
  return { train, holdout, trainIds, holdoutIds };
}
