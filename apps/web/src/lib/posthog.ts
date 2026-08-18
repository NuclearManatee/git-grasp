// @ts-nocheck
/**
 * Cookieless PostHog event helper. No-ops when snippet / project key unset.
 * Drops search events whose query matches shared PII/junk gates.
 */
import { piiOrJunkReason } from '@git-grasp/common/lib/telemetry/scrub.js';

/**
 * @param {string} name
 * @param {Record<string, unknown>} [data]
 */
export function track(name, data = {}) {
  if (typeof window === 'undefined') return;
  const posthog = /** @type {any} */ (window).posthog;
  if (!posthog || typeof posthog.capture !== 'function') {
    if (import.meta.env.DEV) {
      console.debug('[posthog:noop]', name, data);
    }
    const q = (window.__ghTrackQueue ||= []);
    q.push({ name, data, ts: Date.now() });
    return;
  }
  try {
    posthog.capture(name, data);
  } catch (err) {
    console.warn('posthog.capture failed', err);
  }
  const q = (window.__ghTrackQueue ||= []);
  q.push({ name, data, ts: Date.now() });
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
