// @ts-nocheck
import { normalizeExample } from '../lib/validator.js';

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
 * Source preference (lower = better). Curated workflows beat LLM/progit noise.
 */
export function recipeSourceRank(source) {
  const s = String(source || '');
  if (s === 'essential') return 0;
  if (s === 'workflow') return 1;
  if (s.startsWith('golden:')) return 2;
  if (s === 'cheat-sheet') return 3;
  if (s === 'ays') return 4;
  if (s === 'tldr' || s === 'universe') return 5;
  if (s === 'progit') return 6;
  return 7;
}

/**
 * Merge recipes by id + step_signature (NOT primary_example).
 * Earlier list wins on equal source rank when signatures collide.
 * @param {object[]} existing
 * @param {object[]} incoming
 */
export function mergeRecipesBySignature(existing = [], incoming = []) {
  const bySig = new Map();
  const byId = new Map();
  const out = [];

  const consider = (r) => {
    if (!r?.id) return;
    const commands = Array.isArray(r.commands) ? r.commands : [];
    const primary = normalizeExample(r.primary_example || commands[0]?.run || '');
    if (!primary && !commands.length) return;
    const sig = stepSignature(commands.length ? commands : [{ run: primary }]);
    if (!sig) return;

    const recipe = {
      ...r,
      primary_example: primary || commands[0]?.run,
      step_signature: sig,
    };

    if (byId.has(recipe.id)) {
      const prev = byId.get(recipe.id);
      if (recipeSourceRank(recipe.source) < recipeSourceRank(prev.source)) {
        replace(prev, recipe, bySig, byId, out);
      }
      return;
    }

    const prevSig = bySig.get(sig);
    if (prevSig) {
      if (recipeSourceRank(recipe.source) < recipeSourceRank(prevSig.source)) {
        replace(prevSig, recipe, bySig, byId, out);
      }
      return;
    }

    bySig.set(sig, recipe);
    byId.set(recipe.id, recipe);
    out.push(recipe);
  };

  for (const r of existing) consider(r);
  for (const r of incoming) consider(r);
  return out;
}

function replace(prev, next, bySig, byId, out) {
  const idx = out.indexOf(prev);
  if (idx >= 0) out[idx] = next;
  byId.delete(prev.id);
  bySig.delete(prev.step_signature || stepSignature(prev.commands));
  byId.set(next.id, next);
  bySig.set(next.step_signature, next);
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
