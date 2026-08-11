// @ts-nocheck
import { DEFAULT_UMAMI_HOST, DEFAULT_UMAMI_WEBSITE_ID } from './defaults.js';
import { appVersion, catalogIdentity } from '../version.js';
import { SCHEMA_VERSION } from '../../db/constants.js';
import { readConfig } from '../config.js';

export { appVersion };

function catalogFields() {
  const cat = catalogIdentity();
  return {
    catalog_version: cat.corpusVersion,
    schema_version: SCHEMA_VERSION,
  };
}

export function coarseOs() {
  const p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  if (p === 'linux') return 'linux';
  return p || 'unknown';
}

function sessionFields(sessionId) {
  let id = sessionId;
  if (id === undefined) {
    const cfg = readConfig();
    id = typeof cfg.telemetrySessionId === 'string' ? cfg.telemetrySessionId : null;
  }
  return id ? { session_id: id } : {};
}

/**
 * @param {{ sessionId?: string|null }} [opts]
 * @returns {{ name: string, data: Record<string, unknown> }}
 */
export function buildCliOptInEvent(opts = {}) {
  return {
    name: 'cli_opt_in',
    data: {
      source: 'cli',
      app_version: appVersion(),
      os: coarseOs(),
      ...catalogFields(),
      ...sessionFields(opts.sessionId),
    },
  };
}

/**
 * Mirror web_cli_search shape + CLI provenance.
 * @param {object} opts
 * @param {string} opts.query
 * @param {object} opts.response
 * @param {number} opts.latency_ms
 * @param {boolean} [opts.mock]
 * @param {string|null} [opts.sessionId]
 */
export function buildCliSearchEvent({
  query,
  response,
  latency_ms,
  mock = false,
  sessionId,
}) {
  return {
    name: 'cli_search',
    data: {
      source: 'cli',
      app_version: appVersion(),
      os: coarseOs(),
      ...catalogFields(),
      ...sessionFields(sessionId),
      query,
      response,
      latency_ms,
      mock: Boolean(mock),
    },
  };
}

/**
 * Map a search() result (or error) into the response blob for cli_search.
 */
export function searchResponseFromResult(result) {
  if (!result) {
    return { status: 'error', error: 'unknown' };
  }
  const shown = result.displayResults || result.results || [];
  return {
    status: result.status,
    confidence: result.confidence,
    preferredSkill: result.preferredSkill,
    blend: result.blend,
    displayCount: shown.length,
    results: shown.map((r) => ({
      command_id: r.command_id,
      command: r.command || r.example,
      example: r.example,
      score: r.score,
      skill_level: r.skill_level,
    })),
  };
}

export function searchResponseFromError(err) {
  return {
    status: 'error',
    error: String(err?.message || err),
    code: err?.code,
  };
}

export function resolveUmamiEndpoint(env = process.env) {
  const host = (env.GIT_GRASP_UMAMI_HOST || DEFAULT_UMAMI_HOST || '').replace(/\/$/, '');
  // Explicit empty string disables send (tests / hard off). Unset → baked default.
  const websiteId =
    'GIT_GRASP_UMAMI_WEBSITE_ID' in env
      ? String(env.GIT_GRASP_UMAMI_WEBSITE_ID || '')
      : DEFAULT_UMAMI_WEBSITE_ID || '';
  return { host, websiteId };
}
