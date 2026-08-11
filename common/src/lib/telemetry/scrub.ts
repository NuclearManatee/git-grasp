// @ts-nocheck
/**
 * Shared PII / junk query gates for OBSERVE send + EVOLVE FILTER.
 * Keep patterns identical across CLI send, web track, and evolve filter.
 */

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
  if (/^(.)\1{8,}$/.test(q)) return 'spam_repeat';
  return null;
}
