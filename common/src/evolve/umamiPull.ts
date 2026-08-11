// @ts-nocheck
/**
 * Umami HTTP pull client. Local Docker (127.0.0.1:3001) is the default fallback;
 * prod overrides via GIT_GRASP_UMAMI_* / GIT_GRASP_UMAMI_TOKEN / login env.
 */
import { DEFAULT_UMAMI_HOST } from '../lib/telemetry/defaults.js';

const LOCAL_FALLBACK_HOST = 'http://127.0.0.1:3001';

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveUmamiPullConfig(env = process.env) {
  const explicitHost = (env.GIT_GRASP_UMAMI_HOST || '').replace(/\/$/, '');
  const websiteId = env.GIT_GRASP_UMAMI_WEBSITE_ID || '';
  const token = env.GIT_GRASP_UMAMI_TOKEN || env.UMAMI_API_TOKEN || '';
  const username = env.GIT_GRASP_UMAMI_USERNAME || env.UMAMI_USERNAME || 'admin';
  const password = env.GIT_GRASP_UMAMI_PASSWORD || env.UMAMI_PASSWORD || 'umami';
  // Prefer explicit env; else local e2e host when not pointing at cloud defaults blindly.
  let host = explicitHost;
  if (!host) {
    host = LOCAL_FALLBACK_HOST;
  } else if (host === DEFAULT_UMAMI_HOST && !token && !env.GIT_GRASP_UMAMI_FORCE_CLOUD) {
    // Without a token, prefer local for evolve pull (cloud needs API key).
    host = LOCAL_FALLBACK_HOST;
  }
  return { host, websiteId, token, username, password };
}

/**
 * @param {{ host: string, username: string, password: string, fetchImpl?: typeof fetch }} opts
 */
export async function umamiLogin(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const res = await fetchImpl(`${opts.host}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`umami login failed: http ${res.status} ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const token = json.token || json.access_token;
  if (!token) throw new Error('umami login: missing token');
  return token;
}

/**
 * @param {{ host: string, token?: string, username?: string, password?: string, fetchImpl?: typeof fetch }} opts
 */
export async function resolveUmamiAuthToken(opts) {
  if (opts.token) return opts.token;
  return umamiLogin({
    host: opts.host,
    username: opts.username || 'admin',
    password: opts.password || 'umami',
    fetchImpl: opts.fetchImpl,
  });
}

/**
 * Normalize various Umami event list payloads into a flat array.
 * @param {unknown} json
 */
export function normalizeUmamiEventList(json) {
  if (!json) return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.events)) return json.events;
  if (Array.isArray(json.results)) return json.results;
  return [];
}

/**
 * Map a raw Umami API event row into a pull-normalized shape.
 * @param {object} row
 */
export function mapUmamiEventRow(row) {
  const data = row.data || row.eventData || row.properties || {};
  const name = row.eventName || row.name || data.name || '';
  const created =
    row.createdAt || row.created_at || row.timestamp || row.time || Date.now();
  return {
    id: String(row.id || row.eventId || row.event_id || `${name}-${created}`),
    name: String(name),
    createdAt: created,
    sessionId: row.sessionId || row.session_id || data.session_id || null,
    visitId: row.visitId || row.visit_id || null,
    visitorId: row.visitorId || row.visitor_id || null,
    data: typeof data === 'object' && data ? data : {},
  };
}

/**
 * Pull custom events since cursor. Tries /event-data then /events endpoints.
 * @param {object} opts
 * @param {string} opts.host
 * @param {string} opts.websiteId
 * @param {string} opts.token
 * @param {string|null} [opts.sinceIso]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.pageSize]
 */
export async function pullUmamiEvents(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const websiteId = opts.websiteId;
  if (!websiteId) {
    throw new Error('GIT_GRASP_UMAMI_WEBSITE_ID (or seed) required for Umami pull');
  }
  const startAt = opts.sinceIso ? new Date(opts.sinceIso).getTime() : Date.now() - 7 * 86400000;
  const endAt = opts.endAtMs || Date.now() + 60_000;
  const pageSize = opts.pageSize || 200;

  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/json',
  };

  const urls = [
    `${opts.host}/api/websites/${websiteId}/events?startAt=${startAt}&endAt=${endAt}&pageSize=${pageSize}`,
    `${opts.host}/api/websites/${websiteId}/event-data?startAt=${startAt}&endAt=${endAt}`,
  ];

  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers });
      if (!res.ok) {
        lastErr = new Error(`umami pull http ${res.status} for ${url}`);
        continue;
      }
      const json = await res.json();
      const rows = normalizeUmamiEventList(json).map(mapUmamiEventRow);
      return { events: rows, endpoint: url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('umami pull failed');
}

/**
 * List websites (for e2e seed).
 */
export async function listUmamiWebsites({ host, token, fetchImpl = globalThis.fetch }) {
  const res = await fetchImpl(`${host}/api/websites`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`list websites http ${res.status}`);
  const json = await res.json();
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  return [];
}

/**
 * Create a website (e2e seed).
 */
export async function createUmamiWebsite({
  host,
  token,
  name = 'git-grasp-e2e',
  domain = 'localhost',
  fetchImpl = globalThis.fetch,
}) {
  const res = await fetchImpl(`${host}/api/websites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ name, domain }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`create website http ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}
