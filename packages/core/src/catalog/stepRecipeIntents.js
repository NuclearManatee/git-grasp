import { makeIntentId } from '../lib/validator.js';
import { skillPromptList, SKILL_BY_NAME, SKILL_NAMES, isValidSkillLevel } from '../lib/skills.js';
import { loadSkillPersonas, personasPromptBlock } from './personas.js';
import { filterNearDuplicateIntents } from './nearDup.js';
import { PACKAGE_ROOT } from '../lib/paths.js';

/**
 * @param {object} recipe
 * Full band: everyday recipes get 5 paraphrases per skill; others 4 (~16–20 intents/recipe before AYS).
 */
export function intentCountForRecipe(recipe) {
  const common = Number(recipe.simplicity_rank) === 1
    || recipe.source === 'cheat-sheet'
    || recipe.source === 'essential'
    || recipe.source === 'workflow'
    || /^(git status|git commit|git branch|git push|git pull|git stash|git log|git diff|git add|git switch|git restore|git reset)\b/.test(recipe.command || '');
  return common ? 5 : 4;
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
- Per skill: provide intent_descriptions array with AT LEAST the requested intent_target_per_skill items.
- Diversity: D1 paraphrases + D2 colloquial/non-git wording required; D4 misconception phrasings sparse (at most one per skill).
- Tone matches skill name (non-technical colloquial → expert technical).
- Stay faithful to the recipe; do not invent different commands.
- MULTI-STEP recipes (2+ commands): every intent MUST describe the FULL outcome / sequenced goal.
  Use multi-clause wording when natural ("…then…", "move X onto a branch", "undo and recommit without Y").
  Do NOT write intents that would be fully satisfied by only the first command alone.
  Prefer fewer purely atomic one-liners for non-technical on multi-step recipes.
- SINGLE-STEP recipes: intents may be short and atomic as today.
- Do NOT output risk_class or risks fields.
- Glossary (context only): ${JSON.stringify(glossary || {})}`;
}

export function buildIntentAreYouSureSystem({ glossary, personas } = {}) {
  const personaBlock = personasPromptBlock(personas || loadSkillPersonas());
  return `You are auditing intents for ONE git recipe ("Are you sure?").
Add MORE natural-language query variants that are missing — especially panicked junior phrasing,
colloquial non-git wording, mid-level flag-aware phrasing, and terse expert forms.

Persona guidance:
${personaBlock}

Return JSON only:
{
  "sure": false,
  "additional_intents": [
    {
      "skill_level": "non-technical",
      "intent_descriptions": [
        "I messed up my last save point but keep my work"
      ]
    }
  ],
  "rationale": "short"
}
Rules:
- If sure=true, additional_intents MUST be [].
- Cover gaps across skills: ${SKILL_NAMES.join(', ')}.
- Do not repeat existing_intents (case-insensitive).
- No shell operators in intent text.
- Stay faithful to the given recipe commands.
- If the recipe is multi-step, additional intents must still describe the full sequenced goal (not only the first step).
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
      if (idx >= Math.max(intentTarget, 6)) break;
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
 * Merge intent rows; dedupe by recipe_id|skill|lowercase text; re-index ids.
 */
export function mergeIntentRows(existing = [], incoming = []) {
  const seen = new Set();
  const byKey = [];
  for (const row of [...existing, ...incoming]) {
    if (!row?.intent_text || !row.recipe_id) continue;
    const key = `${row.recipe_id}|${row.skill_level}|${String(row.intent_text).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    byKey.push(row);
  }
  const counters = new Map();
  return byKey.map((row) => {
    const ck = `${row.recipe_id}|${row.skill_level}`;
    const idx = counters.get(ck) || 0;
    counters.set(ck, idx + 1);
    return {
      ...row,
      id: makeIntentId(row.recipe_id, row.skill_level, idx),
    };
  });
}

async function applyNearDupFilter(rows, embedFn, maxCosine) {
  if (!embedFn || !rows.length) return rows;
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
        id: makeIntentId(row.recipe_id, level, idx),
      });
      idx += 1;
    }
  }
  return filtered;
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
  rows = await applyNearDupFilter(rows, embedFn, maxCosine);
  return rows;
}

/**
 * Full LLM band + Are-you-sure expansion for one recipe's intents.
 */
export async function generateIntentsForRecipeWithAreYouSure(recipe, {
  llmJson,
  schedule = (fn) => fn(),
  glossary = {},
  personas = null,
  embedFn = null,
  maxCosine = 0.92,
  maxRounds = 3,
  minIntents = null,
  root = PACKAGE_ROOT,
  onRound = () => {},
} = {}) {
  const intentTarget = intentCountForRecipe(recipe);
  const floor = minIntents ?? intentTarget * 4; // all skills
  let rows = await generateIntentsForRecipe(recipe, {
    llmJson,
    schedule,
    glossary,
    personas,
    embedFn,
    maxCosine,
    root,
  });

  const aysSystem = buildIntentAreYouSureSystem({
    glossary,
    personas: personas || loadSkillPersonas(root),
  });
  const rounds = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    if (rows.length >= floor * 1.2) break;
    let audit;
    try {
      audit = await schedule(() => llmJson({
        messages: [
          { role: 'system', content: aysSystem },
          {
            role: 'user',
            content: JSON.stringify({
              are_you_sure: true,
              question: 'Are you sure these intents cover panicked, colloquial, mid, and expert phrasings?',
              min_intents: floor,
              max_additional_per_skill: 3,
              current_count: rows.length,
              recipe: {
                id: recipe.id,
                title: recipe.title,
                commands: recipe.commands,
                primary_example: recipe.primary_example,
              },
              existing_intents: rows.map((r) => ({
                skill_level: r.skill_level,
                intent_text: r.intent_text,
              })),
              intent_target_per_skill: intentTarget,
            }),
          },
        ],
      }));
    } catch (err) {
      rounds.push({
        round,
        sure: false,
        rationale: `llm_error: ${err?.message || err}`,
        added: 0,
        count: rows.length,
      });
      break;
    }

    const extraItem = { intents: audit.additional_intents || [] };
    const added = intentsFromLlmItem(recipe, extraItem, { intentTarget: 6 });
    const before = rows.length;
    rows = mergeIntentRows(rows, added);
    rows = await applyNearDupFilter(rows, embedFn, maxCosine);
    const roundInfo = {
      round,
      sure: Boolean(audit.sure),
      rationale: audit.rationale || '',
      added: rows.length - before,
      count: rows.length,
    };
    rounds.push(roundInfo);
    onRound(roundInfo);

    if (Boolean(audit.sure) && rows.length >= floor) break;
    if ((rows.length - before) === 0) break;
  }

  return { intents: rows, rounds };
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
