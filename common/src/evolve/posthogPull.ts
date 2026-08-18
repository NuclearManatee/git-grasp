// @ts-nocheck
/**
 * PostHog HogQL pull client. Capture ingest (eu.i.posthog.com) is not the query
 * API host (eu.posthog.com). Override via GIT_GRASP_POSTHOG_*.
 */
import { DEFAULT_POSTHOG_API_HOST, DEFAULT_POSTHOG_HOST } from '../lib/telemetry/defaults.js';

/**
 * @param {string} ingestHost
 */
export function derivePosthogApiHost(ingestHost) {
  const host = (ingestHost || '').replace(/\/$/, '');
  if (!host) return DEFAULT_POSTHOG_API_HOST;
  if (host.includes('.i.posthog.com')) {
    return host.replace('.i.posthog.com', '.posthog.com');
  }
  return host;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolvePosthogPullConfig(env = process.env) {
  const ingestHost = (env.GIT_GRASP_POSTHOG_HOST || DEFAULT_POSTHOG_HOST || '').replace(
    /\/$/,
    '',
  );
  const apiHost = (
    env.GIT_GRASP_POSTHOG_API_HOST ||
    derivePosthogApiHost(ingestHost) ||
    DEFAULT_POSTHOG_API_HOST
  ).replace(/\/$/, '');
  const projectId = env.GIT_GRASP_POSTHOG_PROJECT_ID || '';
  const personalApiKey =
    env.GIT_GRASP_POSTHOG_PERSONAL_API_KEY || env.POSTHOG_PERSONAL_API_KEY || '';
  return { ingestHost, apiHost, projectId, personalApiKey };
}

/**
 * @param {unknown} raw
 */
export function parsePosthogProperties(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Map a HogQL / events row into the pull-normalized shape FILTER expects.
 * @param {object} row
 */
export function mapPosthogEventRow(row) {
  const data = parsePosthogProperties(row.properties || row.data);
  const name = row.event || row.name || data.name || '';
  const created = row.timestamp || row.createdAt || row.created_at || Date.now();
  const distinctId = row.distinct_id || row.distinctId || data.distinct_id || null;
  const sessionId = data.session_id || distinctId || null;
  return {
    id: String(row.uuid || row.id || `${name}-${created}`),
    name: String(name),
    createdAt: created,
    sessionId,
    distinctId,
    visitId: row.session_id || data.$session_id || null,
    visitorId: distinctId,
    data: typeof data === 'object' && data ? data : {},
  };
}

/**
 * @param {unknown} json
 */
export function hogqlRowsFromQueryJson(json) {
  if (!json) return [];
  if (Array.isArray(json.results)) {
    const cols = Array.isArray(json.columns) ? json.columns : [];
    if (cols.length && json.results.length && Array.isArray(json.results[0])) {
      return json.results.map((tuple) => {
        const obj = {};
        cols.forEach((c, i) => {
          obj[c] = tuple[i];
        });
        return obj;
      });
    }
    return json.results;
  }
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.events)) return json.events;
  return [];
}

/**
 * Drop the cursor boundary event (and anything before it in sort order).
 * @param {object[]} events
 * @param {string|null|undefined} lastEventId
 */
export function dedupeAfterLastEventId(events, lastEventId) {
  if (!lastEventId || !events?.length) return events || [];
  const id = String(lastEventId);
  const idx = events.findIndex((e) => String(e.id) === id);
  if (idx < 0) return events;
  return events.slice(idx + 1);
}

function hogqlDateTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) {
    return new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  }
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Pull custom events since cursor via HogQL.
 * @param {object} opts
 * @param {string} opts.apiHost
 * @param {string} opts.projectId
 * @param {string} opts.personalApiKey
 * @param {string|null} [opts.sinceIso]
 * @param {string|null} [opts.afterEventId]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {number} [opts.pageSize]
 */
export async function pullPosthogEvents(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const projectId = opts.projectId;
  const token = opts.personalApiKey || opts.token;
  const apiHost = (opts.apiHost || opts.host || '').replace(/\/$/, '');
  if (!projectId) {
    throw new Error('GIT_GRASP_POSTHOG_PROJECT_ID required for PostHog pull');
  }
  if (!token) {
    throw new Error('GIT_GRASP_POSTHOG_PERSONAL_API_KEY required for PostHog pull');
  }
  if (!apiHost) {
    throw new Error('GIT_GRASP_POSTHOG_API_HOST (or HOST) required for PostHog pull');
  }

  const sinceIso = opts.sinceIso || new Date(Date.now() - 7 * 86400000).toISOString();
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 10000, 1), 50000);
  const sinceSql = hogqlDateTime(sinceIso);

  const hogql = [
    'SELECT toString(uuid) AS uuid, event, timestamp, distinct_id, properties',
    'FROM events',
    `WHERE timestamp >= toDateTime('${sinceSql}')`,
    "AND event IN ('cli_search', 'web_cli_search', 'cli_opt_in', 'web_cli_load')",
    'ORDER BY timestamp ASC, uuid ASC',
    `LIMIT ${pageSize}`,
  ].join(' ');

  const url = `${apiHost}/api/projects/${projectId}/query/`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query: hogql },
      name: 'git-grasp-evolve-pull',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`posthog pull http ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  const json = await res.json();
  const all = hogqlRowsFromQueryJson(json).map(mapPosthogEventRow);

  const seen = new Set();
  const deduped = [];
  for (const e of all) {
    const key = String(e.id);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  deduped.sort(
    (a, b) =>
      (typeof a.createdAt === 'number' ? a.createdAt : Date.parse(String(a.createdAt))) -
        (typeof b.createdAt === 'number' ? b.createdAt : Date.parse(String(b.createdAt))) ||
      String(a.id).localeCompare(String(b.id)),
  );

  return {
    events: dedupeAfterLastEventId(deduped, opts.afterEventId),
    endpoint: url,
  };
}

/**
 * Merge Set-Cookie headers into a Cookie request header.
 * @param {string} existing
 * @param {{ getSetCookie?: () => string[], get?: (name: string) => string|null }} headers
 */
export function mergeSetCookie(existing, headers) {
  const jar = new Map();
  for (const part of String(existing || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k) jar.set(k, rest.join('='));
  }
  /** @type {string[]} */
  let list = [];
  if (headers && typeof headers.getSetCookie === 'function') {
    list = headers.getSetCookie() || [];
  } else if (headers && typeof headers.get === 'function') {
    const raw = headers.get('set-cookie');
    if (raw) list = [raw];
  }
  for (const sc of list) {
    const [nv] = String(sc).split(';');
    const eq = nv.indexOf('=');
    if (eq < 1) continue;
    jar.set(nv.slice(0, eq).trim(), nv.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function jsonOrEmpty(res) {
  return res.json().catch(() => ({}));
}

/**
 * Sign up or log in, then return project token + personal API key for local Docker e2e.
 * @param {object} opts
 */
export async function ensurePosthogE2eProject(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const host = String(opts.host || '').replace(/\/$/, '');
  if (!host) throw new Error('PostHog host required');
  const email = opts.email || 'e2e@git-grasp.local';
  const password = opts.password || 'GitGraspE2e!2026';
  const firstName = opts.firstName || 'E2E';
  const organizationName = opts.organizationName || 'git-grasp-e2e';

  let cookie = '';
  const loginRes = await fetchImpl(`${host}/api/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  cookie = mergeSetCookie(cookie, loginRes.headers);
  if (!loginRes.ok) {
    const signupRes = await fetchImpl(`${host}/api/signup/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email,
        password,
        first_name: firstName,
        organization_name: organizationName,
      }),
    });
    cookie = mergeSetCookie(cookie, signupRes.headers);
    if (!signupRes.ok) {
      const text = await signupRes.text().catch(() => '');
      throw new Error(`posthog signup failed: http ${signupRes.status} ${text.slice(0, 200)}`);
    }
  }

  const authHeaders = {
    Cookie: cookie,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const projectsRes = await fetchImpl(`${host}/api/projects/`, { headers: authHeaders });
  if (!projectsRes.ok) {
    throw new Error(`posthog list projects http ${projectsRes.status}`);
  }
  const projectsJson = await jsonOrEmpty(projectsRes);
  const projects = Array.isArray(projectsJson)
    ? projectsJson
    : Array.isArray(projectsJson.results)
      ? projectsJson.results
      : [];
  const project = projects[0];
  if (!project?.id || !project?.api_token) {
    throw new Error('posthog: no project with api_token');
  }

  const keyRes = await fetchImpl(`${host}/api/personal_api_keys/`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ label: 'git-grasp-e2e', scopes: ['*'] }),
  });
  if (!keyRes.ok) {
    const text = await keyRes.text().catch(() => '');
    throw new Error(`posthog personal api key http ${keyRes.status} ${text.slice(0, 200)}`);
  }
  const keyJson = await jsonOrEmpty(keyRes);
  const personalApiKey = keyJson.value || keyJson.api_key || keyJson.key;
  if (!personalApiKey) throw new Error('posthog personal api key missing in response');

  return {
    projectId: String(project.id),
    projectApiKey: String(project.api_token),
    personalApiKey: String(personalApiKey),
  };
}

/**
 * @param {string} host
 * @param {number} [timeoutMs]
 */
export async function posthogReachable(host, timeoutMs = 2000) {
  try {
    const res = await fetch(`${String(host).replace(/\/$/, '')}/_health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status > 0) return true;
  } catch {
    /* try root */
  }
  try {
    const res = await fetch(`${String(host).replace(/\/$/, '')}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

