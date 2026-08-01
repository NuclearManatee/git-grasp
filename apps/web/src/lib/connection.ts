// @ts-nocheck
/**
 * Connection heuristic for adaptive catalog prefetch (not model download).
 * Prefetch catalog when clearly on WiÔÇæFi / ethernet / other high-quality links.
 * If `type` is missing, only prefetch for effectiveType === '4g'.
 * Embedding model always requires explicit "Start playground".
 */

/**
 * @typedef {object} ConnectionInfo
 * @property {string | undefined} type
 * @property {string | undefined} effectiveType
 * @property {boolean | undefined} saveData
 */

/**
 * @param {ConnectionInfo | null | undefined} conn
 * @returns {boolean} true = auto-download assets
 */
export function shouldAutoLoadPlayground(conn) {
  if (!conn) {
    // Unknown: be conservative ÔÇö require opt-in.
    return false;
  }
  if (conn.saveData) return false;

  const type = (conn.type || '').toLowerCase();
  if (type === 'wifi' || type === 'ethernet' || type === 'other') {
    return true;
  }
  if (type === 'cellular' || type === 'wimax' || type === 'bluetooth') {
    return false;
  }

  // type unavailable (common on desktop Chrome without Network Information Type)
  const eff = (conn.effectiveType || '').toLowerCase();
  if (eff === '4g') return true;
  if (eff === '3g' || eff === '2g' || eff === 'slow-2g') return false;

  return false;
}

/** @returns {ConnectionInfo | null} */
export function readConnection() {
  if (typeof navigator === 'undefined') return null;
  const c = /** @type {any} */ (navigator).connection
    || /** @type {any} */ (navigator).mozConnection
    || /** @type {any} */ (navigator).webkitConnection;
  if (!c) return null;
  return {
    type: c.type,
    effectiveType: c.effectiveType,
    saveData: Boolean(c.saveData),
  };
}

export function deviceInfo() {
  if (typeof navigator === 'undefined') {
    return {
      deviceMemory: null,
      hardwareConcurrency: null,
      userAgentClass: 'unknown',
    };
  }
  const ua = navigator.userAgent || '';
  let userAgentClass = 'desktop';
  if (/Mobi|Android|iPhone|iPad/i.test(ua)) userAgentClass = 'mobile';
  else if (/Tablet|iPad/i.test(ua)) userAgentClass = 'tablet';
  return {
    deviceMemory: /** @type {any} */ (navigator).deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    userAgentClass,
  };
}
