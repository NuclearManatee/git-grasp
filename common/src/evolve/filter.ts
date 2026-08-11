// @ts-nocheck
/**
 * FILTER — deterministic denoise + PII gates for OBSERVE search events.
 */
import { SEARCH_EVENT_NAMES } from './schemas.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const TOKENISH_RE =
  /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;
const HOME_PATH_RE = /(?:\/Users\/[^/\s]+|\/home\/[^/\s]+|C:\\Users\\[^\\\s]+)/i;
const PRIVATE_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.|10\.|.*\.local)[^\s]*/i;
const NON_TEXT_RE = /^[\W\d_\s]{1,}$/;

/**
 * @param {string} query
 * @returns {string|null} drop reason or null if ok
 */
export function piiOrJunkReason(query) {
  const q = String(query || '').trim();
  if (!q) return 'empty';
  if (q.length < 2) return 'too_short';
  if (NON_TEXT_RE.test(q) && !/[a-zA-Z]{2,}/.test(q)) return 'non_text';
  if (EMAIL_RE.test(q)) return 'pii_email';
  if (TOKENISH_RE.test(q)) return 'pii_token';
  if (HOME_PATH_RE.test(q)) return 'pii_home_path';
  if (PRIVATE_URL_RE.test(q)) return 'pii_private_url';
  // Very spammy: same char repeated
  if (/^(.)\1{8,}$/.test(q)) return 'spam_repeat';
  return null;
}

function eventPayload(raw) {
  return raw.data || raw.eventData || {};
}

function createdAtMs(raw) {
  const v = raw.createdAt ?? raw.timestamp ?? raw.created_at;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

function threadKeyFor(raw, data) {
  if (data.session_id) return `sid:${data.session_id}`;
  if (raw.sessionId) return `umami:${raw.sessionId}`;
  if (raw.visitId) return `visit:${raw.visitId}`;
  if (raw.visitorId) return `visitor:${raw.visitorId}`;
  return `anon:${raw.id || createdAtMs(raw)}`;
}

/**
 * @param {object[]} rawEvents
 * @param {{ catalogVersion?: string|number|null, burstWindowMs?: number }} [opts]
 */
export function filterSearchEvents(rawEvents, opts = {}) {
  const burstWindowMs = opts.burstWindowMs ?? 1500;
  const drop_reasons = {};
  const kept = [];
  const versions = new Map();

  const bump = (reason) => {
    drop_reasons[reason] = (drop_reasons[reason] || 0) + 1;
  };

  const sorted = [...(rawEvents || [])].sort(
    (a, b) => createdAtMs(a) - createdAtMs(b) || String(a.id).localeCompare(String(b.id)),
  );

  /** @type {Map<string, { query: string, at: number }>} */
  const lastByThread = new Map();

  for (const raw of sorted) {
    const name = String(raw.name || raw.eventName || '');
    if (!SEARCH_EVENT_NAMES.has(name)) {
      bump('not_search');
      continue;
    }
    const data = eventPayload(raw);
    if (data.mock === true || data.mock === 'true') {
      bump('mock');
      continue;
    }
    const query = String(data.query || '').trim();
    const junk = piiOrJunkReason(query);
    if (junk) {
      bump(junk);
      continue;
    }

    const catalogVersion =
      data.catalog_version ?? data.catalogVersion ?? null;
    if (catalogVersion != null && catalogVersion !== '') {
      const key = String(catalogVersion);
      versions.set(key, (versions.get(key) || 0) + 1);
    }

    const at = createdAtMs(raw);
    const threadKey = threadKeyFor(raw, data);
    const prev = lastByThread.get(threadKey);
    if (prev && prev.query === query && at - prev.at <= burstWindowMs) {
      bump('burst_repeat');
      continue;
    }
    lastByThread.set(threadKey, { query, at });

    kept.push({
      id: String(raw.id || raw.eventId || `${threadKey}-${at}`),
      name,
      createdAtMs: at,
      threadKey,
      session_id: data.session_id || raw.sessionId || null,
      query,
      catalog_version: catalogVersion,
      schema_version: data.schema_version ?? null,
      mock: false,
      response: data.response && typeof data.response === 'object' ? data.response : {},
      latency_ms: typeof data.latency_ms === 'number' ? data.latency_ms : undefined,
      source: data.source || (name.startsWith('web_') ? 'web' : 'cli'),
    });
  }

  let catalog_version = opts.catalogVersion ?? null;
  if (catalog_version == null && versions.size > 0) {
    catalog_version = [...versions.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  let partitioned = kept;
  if (catalog_version != null && catalog_version !== '') {
    const before = partitioned.length;
    partitioned = kept.filter(
      (e) => e.catalog_version == null || String(e.catalog_version) === String(catalog_version),
    );
    const droppedMixed = before - partitioned.length;
    if (droppedMixed > 0) bump('catalog_version_mismatch');
  }

  // Refuse truly mixed batches when caller required a version and nothing matches
  if (
    opts.catalogVersion != null &&
    kept.length > 0 &&
    partitioned.length === 0
  ) {
    return {
      events: [],
      drop_reasons: { ...drop_reasons, catalog_version_refuse: kept.length },
      catalog_version: opts.catalogVersion,
      refused: true,
    };
  }

  return {
    events: partitioned,
    drop_reasons,
    catalog_version,
    refused: false,
  };
}
