import { makeIntentId } from '../lib/validator.js';
import { skillPromptList, SKILL_BY_NAME, SKILL_NAMES, isValidSkillLevel } from '../lib/skills.js';
import { loadSkillPersonas, personasPromptBlock } from './personas.js';
import { filterNearDuplicateIntents } from './nearDup.js';
import { PACKAGE_ROOT } from '../lib/paths.js';

/**
 * @param {object} recipe
 */
export function intentCountForRecipe(recipe) {
  const common = Number(recipe.simplicity_rank) === 1
    || recipe.source === 'cheat-sheet'
    || /^(git status|git commit|git branch|git push|git pull|git stash|git log|git diff|git add)\b/.test(recipe.command || '');
  return common ? 5 : 3;
}

export function buildRecipeIntentSystem({ glossary, personas } = {}) {
  const personaBlock = personasPromptBlock(personas || loadSkillPersonas());
  return `You are the git-help RECIPE INTENT WRITER.
Given ONE Git recipe (title + ordered commands with comments), produce skill-level intent variants.
Skill levels (use names in output): ${skillPromptList()}.

Persona guidance (match tone per skill):
${personaBlock}

Return JSON only:
{
  "intents": [
    {
      "skill_level": "beginner",
      "intent_descriptions": [
        "natural language query",
        "another paraphrase"
      ]
    }
  ]
}
Rules:
- Cover ALL four skills: ${SKILL_NAMES.join(', ')}.
- Per skill: provide intent_descriptions array (natural language; no shell operators).
- Diversity: paraphrases + colloquial/non-git wording; at most one misconception phrasing per skill.
- Stay faithful to the recipe; do not invent different commands.
- Do NOT output risk_class or risks fields.
- Glossary (context only): ${JSON.stringify(glossary || {})}`;
}

function coerceSkill(level) {
  if (typeof level === 'string') {
    const key = level.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SKILL_BY_NAME, key)) return SKILL_BY_NAME[key];
  }
  const n = Number(level);
  return isValidSkillLevel(n) ? n : null;
}

/**
 * Flatten LLM JSON into search_intent rows for one recipe.
 */
export function intentsFromLlmItem(recipe, item, { intentTarget = 3 } = {}) {
  const intents = Array.isArray(item?.intents) ? item.intents : [];
  const rows = [];
  for (const intent of intents) {
    const level = coerceSkill(intent.skill_level);
    if (level == null) continue;
    const descs = Array.isArray(intent.intent_descriptions)
      ? intent.intent_descriptions
      : (intent.intent_description ? [intent.intent_description] : []);
    let idx = 0;
    for (const desc of descs) {
      if (!desc) continue;
      if (idx >= Math.max(intentTarget, 5)) break;
      rows.push({
        id: makeIntentId(recipe.id, level, idx),
        recipe_id: recipe.id,
        intent_text: String(desc).trim(),
        skill_level: level,
      });
      idx += 1;
    }
  }
  return rows;
}

/**
 * ONE recipe → ONE LLM call, then near-dup filter.
 */
export async function generateIntentsForRecipe(recipe, {
  llmJson,
  schedule = (fn) => fn(),
  glossary = {},
  personas = null,
  embedFn = null,
  maxCosine = 0.92,
  root = PACKAGE_ROOT,
} = {}) {
  if (!llmJson) throw new Error('llmJson required');
  const intentTarget = intentCountForRecipe(recipe);
  const system = buildRecipeIntentSystem({
    glossary,
    personas: personas || loadSkillPersonas(root),
  });
  const user = {
    recipe: {
      id: recipe.id,
      title: recipe.title,
      commands: recipe.commands,
      explanation: recipe.explanation,
      primary_example: recipe.primary_example,
      command: recipe.command,
    },
    intent_target_per_skill: intentTarget,
  };
  const out = await schedule(() => llmJson({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) },
    ],
  }));

  let rows = intentsFromLlmItem(recipe, out, { intentTarget });

  if (embedFn && rows.length) {
    const bySkill = new Map();
    for (const row of rows) {
      if (!bySkill.has(row.skill_level)) bySkill.set(row.skill_level, []);
      bySkill.get(row.skill_level).push(row);
    }
    const filtered = [];
    for (const [level, group] of bySkill) {
      const texts = group.map((r) => r.intent_text);
      const kept = await filterNearDuplicateIntents(texts, { embedFn, maxCosine });
      const keepSet = new Set(kept.map((t) => t.toLowerCase()));
      let idx = 0;
      for (const row of group) {
        if (!keepSet.has(row.intent_text.toLowerCase())) continue;
        filtered.push({
          ...row,
          id: makeIntentId(recipe.id, level, idx),
        });
        idx += 1;
      }
    }
    rows = filtered;
  }

  return rows;
}

/**
 * Offline / test intents without LLM.
 */
export function heuristicIntentsForRecipe(recipe) {
  const base = [
    recipe.title,
    `how to ${recipe.title}`.toLowerCase(),
    recipe.primary_example,
    `${recipe.command} example`,
  ].filter(Boolean);
  const rows = [];
  for (let skill = 1; skill <= 4; skill += 1) {
    base.forEach((text, idx) => {
      rows.push({
        id: makeIntentId(recipe.id, skill, idx),
        recipe_id: recipe.id,
        intent_text: skill === 1
          ? text.replace(/\bgit\b/gi, '').trim() || text
          : text,
        skill_level: skill,
      });
    });
  }
  return rows;
}
