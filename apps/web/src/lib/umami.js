/**
 * Cookieless Umami event helper. No-ops when script / website id unset.
 */

/**
 * @param {string} name
 * @param {Record<string, unknown>} [data]
 */
export function track(name, data = {}) {
  if (typeof window === 'undefined') return;
  const umami = /** @type {any} */ (window).umami;
  if (!umami || typeof umami.track !== 'function') {
    if (import.meta.env.DEV) {
      console.debug('[umami:noop]', name, data);
    }
    // Expose for Playwright assertions even without Umami
    const q = (window.__ghTrackQueue ||= []);
    q.push({ name, data, ts: Date.now() });
    return;
  }
  try {
    umami.track(name, data);
  } catch (err) {
    console.warn('umami.track failed', err);
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
  track('web_cli_search', payload);
}
