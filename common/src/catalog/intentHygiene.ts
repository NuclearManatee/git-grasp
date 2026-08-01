// @ts-nocheck
/**
 * Drop intents that are basically shell commands, not natural language.
 */
export function isCommandLikeIntent(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (/^git(\s|$)/i.test(t)) return true;
  if (/&&|\|\||;|`/.test(t)) return true;
  return false;
}
