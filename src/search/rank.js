/**
 * Rank catalog rows against a query embedding using cosine similarity.
 */
export function rankResults(rows, queryEmbedding, thresholds, { skillLevel = null } = {}) {
  const topK = thresholds.topK ?? 5;
  const minScore = thresholds.minScore ?? 0.35;
  const maxSecondGap = thresholds.maxSecondGap ?? 0.05;
  const lowConfidenceScore = thresholds.lowConfidenceScore ?? 0.45;
  const requireSkillConsistency = thresholds.requireSkillConsistency !== false;

  let candidates = rows;
  if (skillLevel != null) {
    candidates = rows.filter((r) => r.skill_level === skillLevel);
  }

  const scored = candidates.map((r) => ({
    ...r,
    score: cosineLike(queryEmbedding, r.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
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
