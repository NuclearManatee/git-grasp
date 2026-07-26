import { normalizeExample, recipeSlugFromTitle, makeIntentId } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { deriveCommandKey } from './stepRecipes.js';
import { coerceSkillBandValue } from '../lib/skills.js';
import { normalizeUsage } from '../db/utils.js';
import { ESSENTIAL_COMMANDS } from './enrich.js';
import { enrichRecipesFromWorkflows } from './stepRecipeWorkflows.js';
import { mergeRecipesBySignature, stepSignature } from './recipeIdentity.js';

/**
 * Ensure golden expected examples exist as single-step recipes.
 * Skips when expectedRecipeId is set (workflow goldens).
 */
export function enrichRecipesFromGolden(recipes, goldenCases = [], glossary = DEFAULT_GLOSSARY) {
  const bySig = new Set(recipes.map((r) => r.step_signature || stepSignature(r.commands || [{ run: r.primary_example }])));
  const byId = new Set(recipes.map((r) => r.id));

  for (const g of goldenCases || []) {
    if (g.expectedRecipeId) continue;
    const examples = [
      g.expectedExample,
      g.expectedSimplestExample,
      ...(g.acceptableExamples || []),
    ].filter(Boolean);

    for (const raw of examples) {
      const example = normalizeExample(materializePlaceholders(raw, glossary));
      if (!example) continue;
      const sig = stepSignature([{ run: example }]);
      if (bySig.has(sig)) continue;
      const command = normalizeExample(
        materializePlaceholders(g.expectedCommand || deriveCommandKey(example), glossary),
      );
      const title = `Golden: ${example}`;
      let id = recipeSlugFromTitle(`golden-${example}`);
      if (byId.has(id)) id = `${id}-${byId.size}`;
      const recipe = {
        id,
        title,
        commands: [{ run: example, comment: g.judgeNotes || '' }],
        explanation: g.judgeNotes || `Golden case ${g.id || ''}`.trim(),
        intent_family: '',
        simplicity_rank: 1,
        usage: normalizeUsage({ command_line: example, blurb: '' }, example),
        topic: 'golden',
        primary_example: example,
        command: command.startsWith('git') ? command : deriveCommandKey(example),
        source: `golden:${g.id || 'case'}`,
        step_signature: sig,
      };
      recipes.push(recipe);
      bySig.add(sig);
      byId.add(id);
    }
  }
  return recipes;
}

/**
 * Add essential porcelain recipes when missing.
 */
export function enrichRecipesFromEssentials(recipes, glossary = DEFAULT_GLOSSARY) {
  const bySig = new Set(recipes.map((r) => r.step_signature || stepSignature(r.commands || [{ run: r.primary_example }])));
  for (const group of ESSENTIAL_COMMANDS) {
    for (const ex of group.examples || []) {
      const example = normalizeExample(materializePlaceholders(ex.example, glossary));
      const sig = stepSignature([{ run: example }]);
      if (bySig.has(sig)) continue;
      const id = recipeSlugFromTitle(example);
      const recipe = {
        id,
        title: example,
        commands: [{ run: example, comment: '' }],
        explanation: `Essential: ${example}`,
        intent_family: '',
        simplicity_rank: 1,
        usage: normalizeUsage({ command_line: example, blurb: '' }, example),
        topic: ex.topic || 'essential',
        primary_example: example,
        command: group.command,
        source: 'essential',
        step_signature: sig,
      };
      recipes.push(recipe);
      bySig.add(sig);
    }
  }
  return recipes;
}

export { enrichRecipesFromWorkflows, mergeRecipesBySignature };


/**
 * Inject golden queries as intents for matching recipes.
 */
export function enrichIntentsFromGolden(intents, recipes, goldenCases = []) {
  const byExample = new Map(
    recipes.map((r) => [normalizeExample(r.primary_example), r]),
  );
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const out = [...intents];
  const seen = new Set(intents.map((i) => `${i.recipe_id}|${i.intent_text.toLowerCase()}`));

  for (const g of goldenCases || []) {
    const recipe = (g.expectedRecipeId && byId.get(g.expectedRecipeId))
      || byExample.get(normalizeExample(g.expectedExample || ''));
    if (!recipe || !g.query) continue;
    const skill = (() => {
      const band = g.expectedSkillBand;
      try {
        if (Array.isArray(band) && band.length) return coerceSkillBandValue(band[0]);
        if (band != null) return coerceSkillBandValue(band);
      } catch {
        /* fall through */
      }
      return 2;
    })();
    const key = `${recipe.id}|${String(g.query).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = out.filter((i) => i.recipe_id === recipe.id && i.skill_level === skill).length;
    out.push({
      id: makeIntentId(recipe.id, skill, idx + 100),
      recipe_id: recipe.id,
      intent_text: String(g.query).trim(),
      skill_level: skill,
    });
  }
  return out;
}
