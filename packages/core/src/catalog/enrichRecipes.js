import { normalizeExample, recipeSlugFromTitle, makeIntentId } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { deriveCommandKey } from './stepRecipes.js';
import { coerceSkillBandValue } from '../lib/skills.js';
import { normalizeUsage } from '../db/utils.js';
import { ESSENTIAL_COMMANDS } from './enrich.js';

/**
 * Ensure golden expected examples exist as single-step recipes.
 */
export function enrichRecipesFromGolden(recipes, goldenCases = [], glossary = DEFAULT_GLOSSARY) {
  const byExample = new Map(
    recipes.map((r) => [normalizeExample(r.primary_example), r]),
  );

  for (const g of goldenCases || []) {
    const examples = [
      g.expectedExample,
      g.expectedSimplestExample,
      ...(g.acceptableExamples || []),
    ].filter(Boolean);

    for (const raw of examples) {
      const example = normalizeExample(materializePlaceholders(raw, glossary));
      if (!example || byExample.has(example)) continue;
      const command = normalizeExample(
        materializePlaceholders(g.expectedCommand || deriveCommandKey(example), glossary),
      );
      const title = `Golden: ${example}`;
      const id = recipeSlugFromTitle(`golden-${example}`);
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
      };
      recipes.push(recipe);
      byExample.set(example, recipe);
    }
  }
  return recipes;
}

/**
 * Add essential porcelain recipes when missing.
 */
export function enrichRecipesFromEssentials(recipes, glossary = DEFAULT_GLOSSARY) {
  const byExample = new Map(
    recipes.map((r) => [normalizeExample(r.primary_example), r]),
  );
  for (const group of ESSENTIAL_COMMANDS) {
    for (const ex of group.examples || []) {
      const example = normalizeExample(materializePlaceholders(ex.example, glossary));
      if (byExample.has(example)) continue;
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
      };
      recipes.push(recipe);
      byExample.set(example, recipe);
    }
  }
  return recipes;
}

/**
 * Inject golden queries as intents for matching recipes.
 */
export function enrichIntentsFromGolden(intents, recipes, goldenCases = []) {
  const byExample = new Map(
    recipes.map((r) => [normalizeExample(r.primary_example), r]),
  );
  const out = [...intents];
  const seen = new Set(intents.map((i) => `${i.recipe_id}|${i.intent_text.toLowerCase()}`));

  for (const g of goldenCases || []) {
    const example = normalizeExample(g.expectedExample || '');
    const recipe = byExample.get(example);
    if (!recipe || !g.query) continue;
    const skill = coerceSkillBandValue(g.expectedSkillBand) || 2;
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
