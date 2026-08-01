// @ts-nocheck
import { DEFAULT_UMAMI_HOST, DEFAULT_UMAMI_WEBSITE_ID } from './defaults.js';

export function appVersion() {
  try {
    // Avoid hard dependency on package.json resolution failures
    return process.env.npm_package_version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export function coarseOs() {
  const p = process.platform;
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  if (p === 'linux') return 'linux';
  return p || 'unknown';
}

/**
 * @returns {{ name: string, data: Record<string, unknown> }}
 */
export function buildCliOptInEvent() {
  return {
    name: 'cli_opt_in',
    data: {
      source: 'cli',
      app_version: appVersion(),
      os: coarseOs(),
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
 */
export function buildCliSearchEvent({ query, response, latency_ms, mock = false }) {
  return {
    name: 'cli_search',
    data: {
      source: 'cli',
      app_version: appVersion(),
      os: coarseOs(),
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
  const websiteId = env.GIT_GRASP_UMAMI_WEBSITE_ID || DEFAULT_UMAMI_WEBSITE_ID || '';
  return { host, websiteId };
}
