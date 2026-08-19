// @ts-nocheck
/**
 * Cookieless PostHog event helper. Posts directly to the ingest API.
 * The site snippet loads posthog-js for pageviews; custom events bypass the
 * CDN stub (array.js often never finishes init under our CSP).
 */
import {
  DEFAULT_POSTHOG_HOST,
  DEFAULT_POSTHOG_KEY,
  TELEMETRY_TIMEOUT_MS,
} from '@git-grasp/common/lib/telemetry/defaults.js';
import { piiOrJunkReason } from '@git-grasp/common/lib/telemetry/scrub.js';

/** @type {string | null} */
let webSessionId = null;

function mintWebSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function webSession() {
  if (!webSessionId) webSessionId = mintWebSessionId();
  return webSessionId;
}

function resolveWebEndpoint() {
  const host = (import.meta.env.PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST || '').replace(
    /\/$/,
    '',
  );
  const projectApiKey = import.meta.env.PUBLIC_POSTHOG_KEY || DEFAULT_POSTHOG_KEY || '';
  return { host, projectApiKey };
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} data
 */
async function sendWebEvent(name, data) {
  const { host, projectApiKey } = resolveWebEndpoint();
  if (!host || !projectApiKey) return { ok: false, skipped: true, reason: 'unset' };

  const payload = {
    api_key: projectApiKey,
    event: name,
    distinct_id: webSession(),
    properties: {
      ...data,
      session_id: webSession(),
      $lib: 'git-grasp-web',
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), TELEMETRY_TIMEOUT_MS) : null;
  try {
    const res = await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ac?.signal,
    });
    return { ok: res.ok, reason: res.ok ? undefined : `http ${res.status}` };
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [data]
 */
export function track(name, data = {}) {
  if (typeof window === 'undefined') return;
  const q = (window.__ghTrackQueue ||= []);
  q.push({ name, data, ts: Date.now() });

  void sendWebEvent(name, data).then((result) => {
    if (import.meta.env.DEV && !result.ok && !result.skipped) {
      console.debug('[posthog:send]', name, result.reason);
    }
  });
}

/**
 * @param {object} payload
 */
export function trackWebCliLoad(payload) {
  track('web_cli_load', payload);
}

/**
 * @param {object} payload
 */
export function trackWebCliSearch(payload) {
  if (payload?.query != null && piiOrJunkReason(payload.query)) {
    if (import.meta.env.DEV) {
      console.debug('[posthog:scrub]', payload.query);
    }
    return;
  }
  track('web_cli_search', payload);
}
