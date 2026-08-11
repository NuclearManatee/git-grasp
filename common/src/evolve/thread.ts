// @ts-nocheck
/**
 * THREAD — chronological search journeys from filtered events.
 */
import { labelFromResponse } from './label.js';

export const DEFAULT_GAP_MS = 45_000;
export const SOFT_MERGE_GAP_MS = 90_000;
export const MAX_THREAD_EVENTS = 12;

/**
 * Rough near-edit: shared token overlap or small Levenshtein relative length.
 * @param {string} a
 * @param {string} b
 */
export function isNearEditQuery(a, b) {
  const x = String(a || '')
    .toLowerCase()
    .trim();
  const y = String(b || '')
    .toLowerCase()
    .trim();
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.includes(y) || y.includes(x)) return true;
  const tx = new Set(x.split(/\s+/).filter(Boolean));
  const ty = new Set(y.split(/\s+/).filter(Boolean));
  if (tx.size === 0 || ty.size === 0) return false;
  let inter = 0;
  for (const t of tx) if (ty.has(t)) inter += 1;
  const union = new Set([...tx, ...ty]).size;
  const jaccard = inter / union;
  if (jaccard >= 0.5) return true;
  // cheap length-normalized edit for short strings
  if (Math.max(x.length, y.length) <= 64) {
    const dist = levenshtein(x, y);
    return dist / Math.max(x.length, y.length) <= 0.35;
  }
  return false;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/**
 * Unique-query entropy proxy: too many distinct queries → likely NAT blob.
 * @param {object[]} events
 */
export function threadEntropyTooHigh(events, maxUnique = 8) {
  const uniq = new Set(events.map((e) => e.query));
  return uniq.size > maxUnique;
}

/**
 * @param {import('./schemas.js').FilteredSearchEvent[]} events
 * @param {{ gapMs?: number, softGapMs?: number, maxEvents?: number }} [opts]
 */
export function buildThreads(events, opts = {}) {
  const gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
  const softGapMs = opts.softGapMs ?? SOFT_MERGE_GAP_MS;
  const maxEvents = opts.maxEvents ?? MAX_THREAD_EVENTS;

  /** @type {Map<string, import('./schemas.js').FilteredSearchEvent[]>} */
  const byKey = new Map();
  for (const e of events || []) {
    const k = e.threadKey || 'anon';
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(e);
  }

  /** @type {import('./schemas.js').Journey[]} */
  const journeys = [];
  let droppedOversized = 0;

  for (const [threadKey, list] of byKey) {
    list.sort((a, b) => a.createdAtMs - b.createdAtMs);
    /** @type {import('./schemas.js').FilteredSearchEvent[][]} */
    const segments = [];
    let cur = [];
    for (const ev of list) {
      const labeled = {
        ...ev,
        label: labelFromResponse(ev.response || {}),
      };
      if (cur.length === 0) {
        cur.push(labeled);
        continue;
      }
      const prev = cur[cur.length - 1];
      const dt = labeled.createdAtMs - prev.createdAtMs;
      let merge = false;
      if (dt <= gapMs) merge = true;
      else if (dt <= softGapMs && isNearEditQuery(prev.query, labeled.query)) merge = true;
      if (!merge) {
        segments.push(cur);
        cur = [labeled];
      } else {
        cur.push(labeled);
      }
    }
    if (cur.length) segments.push(cur);

    for (const seg of segments) {
      if (seg.length > maxEvents || threadEntropyTooHigh(seg)) {
        droppedOversized += 1;
        // Do not feed oversized / NAT-like blobs
        continue;
      }
      const withAbandon = applyAbandonLabels(seg);
      const final = withAbandon[withAbandon.length - 1];
      const finalLabel = final.label;
      const missLike = finalLabel === 'miss' || finalLabel === 'abandon' || finalLabel === 'weak';
      const catalog_version =
        withAbandon.map((e) => e.catalog_version).find((v) => v != null) ?? null;
      journeys.push({
        threadKey,
        catalog_version,
        events: withAbandon,
        finalLabel,
        missLike,
      });
    }
  }

  return { journeys, droppedOversized };
}

/**
 * Terminal miss/weak with no later success → abandon.
 * @param {import('./schemas.js').FilteredSearchEvent[]} events
 */
export function applyAbandonLabels(events) {
  const out = events.map((e) => ({ ...e }));
  const hasLaterSatisfied = (from) => {
    for (let i = from + 1; i < out.length; i += 1) {
      if (out[i].label === 'satisfied') return true;
    }
    return false;
  };
  for (let i = 0; i < out.length; i += 1) {
    if (
      (out[i].label === 'miss' || out[i].label === 'weak') &&
      i === out.length - 1 &&
      !hasLaterSatisfied(i)
    ) {
      if (out[i].label === 'miss' || out[i].label === 'weak') {
        out[i] = { ...out[i], label: i === out.length - 1 ? 'abandon' : out[i].label };
      }
    }
  }
  // Only mark the last event as abandon when miss/weak
  const last = out[out.length - 1];
  if (last && (last.label === 'miss' || last.label === 'weak' || last.label === 'abandon')) {
    // If any prior was satisfied and last is miss → still abandon (gave up after success? rare)
    // Plan: abandon = last in thread + miss/weak + no later success (always true for last)
    if (last.label === 'miss' || last.label === 'weak') {
      out[out.length - 1] = { ...last, label: 'abandon' };
    }
  }
  return out;
}

/**
 * @param {import('./schemas.js').Journey} journey
 * @returns {import('./schemas.js').FeederItem|null}
 */
export function journeyToFeederItem(journey) {
  if (!journey?.missLike) return null;
  const final = journey.events[journey.events.length - 1];
  const response = final.response || {};
  const displayedIds = (response.results || [])
    .map((r) => String(r.command_id ?? r.id ?? ''))
    .filter(Boolean);
  const prior = journey.events.slice(0, -1).map((e) => e.query);
  return {
    query: final.query,
    displayedIds,
    confidence: typeof response.confidence === 'number' ? response.confidence : null,
    status: response.status != null ? String(response.status) : null,
    journey: prior,
    source: 'observe',
    catalog_version: journey.catalog_version ?? final.catalog_version ?? null,
    eventIds: journey.events.map((e) => e.id),
    threadKey: journey.threadKey,
    finalLabel: journey.finalLabel,
    hit: false,
    correctExists: true,
  };
}

/**
 * @param {import('./schemas.js').Journey[]} journeys
 */
export function journeysToFeeder(journeys) {
  const items = [];
  for (const j of journeys) {
    const item = journeyToFeederItem(j);
    if (item) items.push(item);
  }
  return items;
}
