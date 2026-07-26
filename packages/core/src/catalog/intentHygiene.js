import { normalizeExample } from '../lib/validator.js';

/**
 * True if intent text is basically a pasteable git command (not natural language).
 * @param {string} text
 */
export function isCommandLikeIntent(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  // Pure git invocation (optional leading $)
  if (/^\$?\s*git(\s|$)/i.test(t) && !/[?]/.test(t) && t.split(/\s+/).length <= 12) {
    // Allow NL that starts with "git" as a verb in a sentence: "git rid of…" rare; still filter.
    // Keep if it has clear sentence glue after a short git mention
    if (/^git\s+\S+/i.test(t) && !/\b(how|want|need|please|can|should|help|me|my|the|a|to)\b/i.test(t)) {
      return true;
    }
  }
  // Exact match to a normalized example shape
  const norm = normalizeExample(t);
  if (/^git\s+\S+/.test(norm) && norm === t.replace(/^\$\s*/, '').trim()) {
    return true;
  }
  return false;
}

/**
 * Drop command-like intents; optionally also drop those equal to a recipe primary.
 * @param {object[]} intents
 * @param {object[]} [recipes]
 */
export function filterCommandLikeIntents(intents, recipes = []) {
  const primaries = new Set(
    (recipes || []).map((r) => normalizeExample(r.primary_example || r.commands?.[0]?.run || '').toLowerCase())
      .filter(Boolean),
  );
  const kept = [];
  const dropped = [];
  for (const intent of intents || []) {
    const text = String(intent.intent_text || intent.intent_description || '').trim();
    if (isCommandLikeIntent(text)) {
      dropped.push({ id: intent.id, reason: 'command_like', text });
      continue;
    }
    if (primaries.has(normalizeExample(text).toLowerCase())) {
      dropped.push({ id: intent.id, reason: 'equals_primary', text });
      continue;
    }
    kept.push(intent);
  }
  return { intents: kept, dropped };
}
