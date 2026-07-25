/**
 * Rank catalog rows against a query embedding using cosine similarity.
 */
export function rankResults(rows, queryEmbedding, thresholds, { skillLevel = null } = {}) {
  const topK = thresholds.topK ?? 5;
  const minScore = thresholds.minScore ?? 0.35;
  const maxSecondGap = thresholds.maxSecondGap ?? 0.05;
  const lowConfidenceScore = thresholds.lowConfidenceScore ?? 0.45;
  const requireSkillConsistency = thresholds.requireSkillConsistency !== false;
  const specificityWindow = thresholds.specificityWindow ?? 0.12;
  const promoteMargin = thresholds.specificityPromoteMargin ?? 0.05;

  let candidates = rows;
  if (skillLevel != null) {
    candidates = rows.filter((r) => r.skill_level === skillLevel);
  }

  const scored = candidates.map((r) => ({
    ...r,
    score: cosineLike(queryEmbedding, r.embedding),
  }));
  scored.sort((a, b) => b.score - a.score || specificityKey(b.command) - specificityKey(a.command));

  // Prefer a more specific command when nearly as similar as a bare prefix.
  preferSpecificCommands(scored, specificityWindow, promoteMargin);

  const top = scored.slice(0, topK);

  if (top.length === 0) {
    return {
      status: 'empty',
      results: [],
      lowConfidence: false,
      ambiguous: false,
    };
  }

  const first = top[0];
  const second = top[1];
  const lowConfidence = first.score < lowConfidenceScore;
  const gap = second ? first.score - second.score : 1;
  let ambiguous = Boolean(second && gap < maxSecondGap);

  if (requireSkillConsistency && second && first.command !== second.command && gap < maxSecondGap * 2) {
    ambiguous = true;
  }

  // Still return best match even if below minScore (low confidence warning)
  const belowFloor = first.score < minScore;

  return {
    status: ambiguous ? 'ambiguous' : 'ok',
    results: ambiguous ? top.slice(0, 2) : [first],
    lowConfidence: lowConfidence || belowFloor,
    ambiguous,
    gap,
  };
}

function specificityKey(command) {
  return String(command || '').trim().split(/\s+/).filter(Boolean).length;
}

function isCommandPrefix(shorter, longer) {
  const a = String(shorter || '').trim().split(/\s+/);
  const b = String(longer || '').trim().split(/\s+/);
  if (a.length >= b.length) return false;
  return a.every((tok, i) => tok === b[i]);
}

/**
 * If a short command leads and a longer command that extends it sits within
 * `promoteMargin` score points, promote the best-scoring longer form.
 */
export function preferSpecificCommands(scored, window = 0.08, promoteMargin = 0.035) {
  if (!Array.isArray(scored) || scored.length < 2) return scored;
  const head = scored[0];
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 1; i < Math.min(scored.length, 25); i += 1) {
    const cand = scored[i];
    if (head.score - cand.score > window) break;
    if (head.score - cand.score > promoteMargin) continue;
    if (!isCommandPrefix(head.command, cand.command)) continue;
    if (cand.score > bestScore) {
      bestScore = cand.score;
      bestIdx = i;
    }
  }
  if (bestIdx > 0) {
    const [picked] = scored.splice(bestIdx, 1);
    scored.unshift(picked);
  }
  return scored;
}

function cosineLike(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function normalizeQuery(q, enabled = true) {
  if (!enabled) return String(q).trim();
  return String(q)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
