// @ts-nocheck
/**
 * Intent fidelity filters for expand-intents (primary-verb focused).
 */
import { isCommandLikeIntent } from '../catalog/intentHygiene.js';
import { verbFromCommandLine } from './coverage.js';
import { parseCommands } from '../db/recipeFormat.js';

import { INTENT_EXPAND_BATCH } from '../db/constants.js';

/** Default fidelity filter cap per expand batch (not final per-recipe cap). */
export const INTENT_CAP_PER_RECIPE = INTENT_EXPAND_BATCH;

/** Cheap cross-verb lexicon traps. */
const LEXICON_TRAPS: { role: string; needles: RegExp; preferVerb: string }[] = [
  {
    role: 'authorship_vs_bisect',
    needles: /\b(who wrote|blame|each line|last modified this line)\b/i,
    preferVerb: 'git blame',
  },
  {
    role: 'bisect_vs_blame',
    needles: /\b(who introduced|binary search|bisect|which commit broke)\b/i,
    preferVerb: 'git bisect',
  },
  {
    role: 'identity_vs_rename',
    needles: /\b(username|user\.name|user\.email|author name|my git email)\b/i,
    preferVerb: 'git config',
  },
];

/**
 * Filter + cap intents for a recipe. Primary-step fidelity.
 */
export function filterIntentsForRecipe(recipe, intents, opts = {}) {
  const steps = parseCommands(recipe?.command_recipe ?? recipe);
  const primary = steps[0]?.command || '';
  const primaryVerb = verbFromCommandLine(primary) || '';
  const verbToken = primaryVerb.replace(/^git\s+/i, '').toLowerCase();
  const cap = opts.cap ?? INTENT_CAP_PER_RECIPE;
  const out = [];
  const seen = new Set();

  for (const raw of intents || []) {
    const intent_text = String(raw?.intent_text || '').trim();
    if (!intent_text) continue;
    if (isCommandLikeIntent(intent_text)) continue;
    const key = intent_text.toLowerCase();
    if (seen.has(key)) continue;

    // Cross-verb lexicon: drop if clearly better for another verb.
    let trapped = false;
    for (const trap of LEXICON_TRAPS) {
      if (trap.needles.test(intent_text) && primaryVerb && trap.preferVerb !== primaryVerb) {
        // Allow if primary token still present
        if (verbToken && new RegExp(`\\b${verbToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(intent_text)) {
          continue;
        }
        trapped = true;
        break;
      }
    }
    if (trapped) continue;

    seen.add(key);
    out.push({
      skill_level: raw.skill_level,
      intent_category: raw.intent_category,
      intent_text,
    });
    if (out.length >= cap) break;
  }
  return out;
}

/** Listing text for expand-intents: primary line + full recipe steps. */
export function primaryStepListing(recipe) {
  const steps = parseCommands(recipe?.command_recipe ?? recipe);
  const primary = steps[0];
  if (!primary) return { primary: '', listing: '(none)' };
  const listing = steps
    .map((s, i) => {
      const mark = i === 0 ? ' (primary)' : '';
      return `- ${s.command}${s.comment ? ` # ${s.comment}` : ''}${mark}`;
    })
    .join('\n');
  return { primary: primary.command, listing };
}
