// @ts-nocheck
/**
 * Intent fidelity filters for expand-intents (primary-verb focused).
 */
import { isCommandLikeIntent } from '../catalog/intentHygiene.js';
import { verbFromCommandLine } from './coverage.js';
import { parseCommands } from '../db/recipeFormat.js';
import { INTENT_EXPAND_BATCH } from '../db/constants.js';
import { loadLexiconTraps } from './evalImprove/lexiconTraps.js';

/** Default fidelity filter cap per expand batch (not final per-recipe cap). */
export const INTENT_CAP_PER_RECIPE = INTENT_EXPAND_BATCH;

function normVerb(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function recipeVerbs(recipe) {
  const out = [];
  for (const s of parseCommands(recipe?.command_recipe ?? recipe)) {
    const v = verbFromCommandLine(s.command);
    if (v) out.push(normVerb(v));
  }
  return [...new Set(out)];
}

/**
 * For composition recipes (≥2 steps): require intent text to cue ≥2 recipe verbs
 * (or a multi-action cue like "and"/"then" plus the primary verb).
 * @param {string} intentText
 * @param {string[]} verbs
 */
export function intentCoversComposition(intentText, verbs) {
  if (!verbs || verbs.length < 2) return true;
  const q = String(intentText || '').toLowerCase();
  let hits = 0;
  for (const v of verbs) {
    const bare = v.replace(/^git\s+/, '');
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b(?:git\\s+)?${escaped}\\b`, 'i');
    if (re.test(q)) hits += 1;
  }
  if (hits >= 2) return true;
  if (hits >= 1 && (/\band\b/.test(q) || /\bthen\b/.test(q))) return true;
  return false;
}

/**
 * Filter + cap intents for a recipe. Primary-step fidelity.
 * Lexicon traps load from common/taxonomy/lexicon_traps.json (seed + eval rounds).
 * Composition recipes additionally require multi-step coverage cues.
 */
export function filterIntentsForRecipe(recipe, intents, opts = {}) {
  const steps = parseCommands(recipe?.command_recipe ?? recipe);
  const primary = steps[0]?.command || '';
  const primaryVerb = verbFromCommandLine(primary) || '';
  const verbToken = primaryVerb.replace(/^git\s+/i, '').toLowerCase();
  const cap = opts.cap ?? INTENT_CAP_PER_RECIPE;
  const traps = opts.traps || loadLexiconTraps({ traps: opts.trapsFile });
  const verbs = recipeVerbs(recipe);
  const requireComposition =
    opts.requireComposition === true || recipe?.mutation_kind === 'composition';
  const out = [];
  const seen = new Set();

  for (const raw of intents || []) {
    const intent_text = String(raw?.intent_text || '').trim();
    if (!intent_text) continue;
    if (isCommandLikeIntent(intent_text)) continue;
    const key = intent_text.toLowerCase();
    if (seen.has(key)) continue;

    let trapped = false;
    for (const trap of traps) {
      if (
        trap.needles.test(intent_text) &&
        primaryVerb &&
        trap.preferVerb !== primaryVerb
      ) {
        if (
          verbToken &&
          new RegExp(
            `\\b${verbToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
            'i',
          ).test(intent_text)
        ) {
          continue;
        }
        trapped = true;
        break;
      }
    }
    if (trapped) continue;

    if (requireComposition && !intentCoversComposition(intent_text, verbs)) {
      continue;
    }

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
