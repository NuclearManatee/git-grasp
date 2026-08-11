// @ts-nocheck
import { normalizeExample } from '../lib/normalizeText.js';

/**
 * Canonical multi-step identity: ordered normalized runs joined by newlines.
 * @param {{ run?: string }[]|string[]} commandsOrRuns
 */
export function stepSignature(commandsOrRuns) {
  const runs = (commandsOrRuns || []).map((c) => {
    if (typeof c === 'string') return normalizeExample(c);
    return normalizeExample(c?.command || c?.run || '');
  }).filter(Boolean);
  return runs.join('\n');
}

/**
 * Pasteable clipboard text: all runs, one per line.
 * @param {object} r
 */
export function clipboardTextFromRecipe(r) {
  if (Array.isArray(r?.commands) && r.commands.length) {
    return r.commands
      .map((c) => normalizeExample(c.command || c.run))
      .filter(Boolean)
      .join('\n');
  }
  return normalizeExample(r?.example || r?.primary_example || r?.command || '') || null;
}
