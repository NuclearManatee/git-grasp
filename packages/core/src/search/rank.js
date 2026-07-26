import { skillAtMost } from '../lib/skills.js';
import { normalizeExample } from '../lib/validator.js';

/**
 * Rank catalog rows against a query embedding using cosine similarity.
 * Order: exactness (score) > simplicity within family > example specificity.
 */
export function rankResults(rows, queryEmbedding, thresholds, { skillLevel = null } = {}) {
  const topK = thresholds.topK ?? 5;
  const maxSecondGap = thresholds.maxSecondGap ?? 0.05;
  const yellowScore = thresholds.confidenceYellowScore ?? thresholds.lowConfidenceScore ?? 0.45;
  const redScore = thresholds.confidenceRedScore ?? 0.30;
  const requireSkillConsistency = thresholds.requireSkillConsistency !== false;
  const specificityWindow = thresholds.specificityWindow ?? 0.12;
  const promoteMargin = thresholds.specificityPromoteMargin ?? 0.05;
  const simplicityWindow = thresholds.simplicityWindow ?? 0.08;
  const advancedWindow = thresholds.advancedWindow ?? 0.12;

  let candidates = rows;
  if (skillLevel != null) {
    candidates = rows.filter((r) => skillAtMost(r.skill_level, skillLevel));
  }

  const scored = candidates.map((r) => ({
    ...r,
    example: r.example ?? r.command,
    usage: r.usage ?? '',
    intent_family: r.intent_family ?? '',
    simplicity_rank: Number(r.simplicity_rank ?? 1),
    score: typeof r._forcedScore === 'number'
      ? r._forcedScore
      : cosineLike(queryEmbedding, r.embedding),
  }));

  scored.sort((a, b) => compareRank(a, b));

  // Prefer a more specific example when nearly as similar as a bare prefix.
  preferSpecificExamples(scored, specificityWindow, promoteMargin);

  // Within score window of the head, prefer simplest in the same family.
  preferSimplestInFamily(scored, simplicityWindow);

  // Prefer single-step over multi-step when scores are close (protects atomic queries).
  preferFewerSteps(scored, simplicityWindow);

  const top = scored.slice(0, topK);

  if (top.length === 0) {
    return {
      status: 'empty',
      results: [],
      advanced: null,
      confidence: 'very_low',
      lowConfidence: true,
      ambiguous: false,
    };
  }

  const first = top[0];
  const advanced = pickAdvancedAlternate(scored, first, advancedWindow);

  // Cross-family ambiguity only
  const secondOtherFamily = top.find(
    (r) => r !== first && familyKey(r) !== familyKey(first),
  );
  const gap = secondOtherFamily ? first.score - secondOtherFamily.score : 1;
  let ambiguous = Boolean(secondOtherFamily && gap < maxSecondGap);

  if (
    requireSkillConsistency
    && secondOtherFamily
    && exampleKey(first) !== exampleKey(secondOtherFamily)
    && gap < maxSecondGap * 2
  ) {
    ambiguous = true;
  }

  const confidence = confidenceTier(first.score, yellowScore, redScore);
  const lowConfidence = confidence !== 'ok';

  if (ambiguous && secondOtherFamily) {
    return {
      status: 'ambiguous',
      results: [first, secondOtherFamily],
      advanced: null,
      confidence,
      lowConfidence,
      ambiguous: true,
      gap,
    };
  }

  return {
    status: 'ok',
    results: [first],
    advanced,
    confidence,
    lowConfidence,
    ambiguous: false,
    gap,
  };
}

/**
 * @param {number} score
 * @param {number} yellow
 * @param {number} red
 * @returns {'ok' | 'low' | 'very_low'}
 */
export function confidenceTier(score, yellow = 0.45, red = 0.30) {
  if (score < red) return 'very_low';
  if (score < yellow) return 'low';
  return 'ok';
}
function familyKey(r) {
  return String(r.intent_family || '').trim() || `cmd:${r.command}`;
}

function exampleKey(r) {
  return normalizeExample(r.example ?? r.command);
}

function compareRank(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const sa = Number(a.simplicity_rank ?? 1);
  const sb = Number(b.simplicity_rank ?? 1);
  if (sa !== sb) return sa - sb;
  return specificityKey(b.example ?? b.command) - specificityKey(a.example ?? a.command);
}

function specificityKey(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function isExamplePrefix(shorter, longer) {
  const a = normalizeExample(shorter).split(/\s+/);
  const b = normalizeExample(longer).split(/\s+/);
  if (a.length >= b.length) return false;
  return a.every((tok, i) => tok === b[i]);
}

/**
 * If a short example leads and a longer example that extends it sits within
 * `promoteMargin` score points, promote the best-scoring longer form.
 */
export function preferSpecificExamples(scored, window = 0.08, promoteMargin = 0.035) {
  if (!Array.isArray(scored) || scored.length < 2) return scored;
  const head = scored[0];
  let bestIdx = -1;
  let bestScore = -Infinity;
  for (let i = 1; i < Math.min(scored.length, 25); i += 1) {
    const cand = scored[i];
    if (head.score - cand.score > window) break;
    if (head.score - cand.score > promoteMargin) continue;
    if (!isExamplePrefix(head.example ?? head.command, cand.example ?? cand.command)) continue;
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

/** @deprecated use preferSpecificExamples */
export function preferSpecificCommands(scored, window, promoteMargin) {
  return preferSpecificExamples(scored, window, promoteMargin);
}

/**
 * Among candidates within simplicityWindow of head score and same family,
 * promote the lowest simplicity_rank.
 */
export function preferSimplestInFamily(scored, window = 0.08) {
  if (!Array.isArray(scored) || scored.length < 2) return scored;
  const head = scored[0];
  const fam = familyKey(head);
  let bestIdx = 0;
  let bestRank = Number(head.simplicity_rank ?? 1);
  for (let i = 1; i < Math.min(scored.length, 40); i += 1) {
    const cand = scored[i];
    if (head.score - cand.score > window) break;
    if (familyKey(cand) !== fam) continue;
    const rank = Number(cand.simplicity_rank ?? 1);
    if (rank < bestRank || (rank === bestRank && cand.score > scored[bestIdx].score)) {
      bestRank = rank;
      bestIdx = i;
    }
  }
  if (bestIdx > 0) {
    const [picked] = scored.splice(bestIdx, 1);
    scored.unshift(picked);
  }
  return scored;
}

function stepCount(r) {
  if (Array.isArray(r.commands) && r.commands.length) return r.commands.length;
  return 1;
}

/**
 * Within score window, prefer fewer steps (single-command over workflows).
 */
export function preferFewerSteps(scored, window = 0.08) {
  if (!Array.isArray(scored) || scored.length < 2) return scored;
  const head = scored[0];
  let bestIdx = 0;
  let bestSteps = stepCount(head);
  for (let i = 1; i < Math.min(scored.length, 40); i += 1) {
    const cand = scored[i];
    if (head.score - cand.score > window) break;
    const steps = stepCount(cand);
    if (steps < bestSteps || (steps === bestSteps && cand.score > scored[bestIdx].score)) {
      bestSteps = steps;
      bestIdx = i;
    }
  }
  if (bestIdx > 0) {
    const [picked] = scored.splice(bestIdx, 1);
    scored.unshift(picked);
  }
  return scored;
}

function pickAdvancedAlternate(scored, primary, window) {
  const fam = familyKey(primary);
  const primaryEx = exampleKey(primary);
  let best = null;
  for (let i = 0; i < Math.min(scored.length, 40); i += 1) {
    const cand = scored[i];
    if (primary.score - cand.score > window) break;
    if (familyKey(cand) !== fam) continue;
    if (exampleKey(cand) === primaryEx) continue;
    const rank = Number(cand.simplicity_rank ?? 1);
    const primaryRank = Number(primary.simplicity_rank ?? 1);
    if (rank <= primaryRank) continue;
    if (!best || rank > Number(best.simplicity_rank ?? 1) || (rank === Number(best.simplicity_rank ?? 1) && cand.score > best.score)) {
      best = cand;
    }
  }
  return best;
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
