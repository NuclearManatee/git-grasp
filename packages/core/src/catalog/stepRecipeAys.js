import { TOPIC_CHECKLIST, critiqueCoverage } from './critique.js';
import {
  validateRecipe,
  validateExample,
  recipeSlugFromTitle,
  normalizeExample,
  commandSlug,
} from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { normalizeUsage } from '../db/utils.js';
import { deriveCommandKey } from './stepRecipes.js';
import { mergeRecipesBySignature, stepSignature } from './recipeIdentity.js';

/**
 * System prompt: expand recipe catalog with edge / complex gaps.
 */
export function buildRecipeAreYouSureSystem(glossary) {
  return `You are auditing a git-help RECIPE catalog for completeness ("Are you sure?").
Focus on slightly more complex everyday cases and edge cases NOT already covered
(history rewrite recovery, conflict abort, detached HEAD, upstream tracking,
interactive rebase abort, stash including untracked, amend --no-edit, restore staged, etc.).

Return JSON only:
{
  "sure": false,
  "missing_topics": ["undo"],
  "additional_recipes": [
    {
      "title": "Soft-undo last commit keeping changes staged",
      "topic": "undo",
      "command": "git reset",
      "explanation": "Moves HEAD back one commit; index and worktree keep the changes.",
      "commands": [
        { "run": "git reset --soft HEAD~1", "comment": "Keep changes staged" }
      ]
    }
  ],
  "rationale": "short"
}
Rules:
- If sure=true, additional_recipes MUST be [].
- Prefer 1–3 step recipes; multi-step only when the workflow truly needs it.
- Return at most 8 additional_recipes per response (keep JSON compact).
- Every commands[].run MUST be a pasteable git invocation (starts with git, no shell operators && || | ; \` $()).
- Use ONLY concrete glossary tokens (no <placeholders>): ${JSON.stringify(glossary || DEFAULT_GLOSSARY)}
- topic must be one of: ${TOPIC_CHECKLIST.join(', ')}
- Do NOT duplicate ordered command sequences already listed in the user payload.
- Shared first commands across different workflows are OK when later steps differ.
- Do NOT invent non-git tools or fake flags.
- Aim for edge/complex coverage rather than more "git status" variants.`;
}

/**
 * Normalize one LLM recipe draft into a validated recipe or null.
 */
export function materializeAysRecipe(draft, {
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
  source = 'ays',
} = {}) {
  if (!draft || typeof draft !== 'object') return null;
  const commands = (Array.isArray(draft.commands) ? draft.commands : [])
    .map((c) => ({
      run: normalizeExample(materializePlaceholders(String(c?.run || ''), glossary)),
      comment: String(c?.comment || '').trim(),
    }))
    .filter((c) => c.run);
  if (!commands.length && draft.primary_example) {
    commands.push({
      run: normalizeExample(materializePlaceholders(draft.primary_example, glossary)),
      comment: '',
    });
  }
  if (!commands.length) return null;

  for (const step of commands) {
    const v = validateExample(step.run);
    if (!v.ok) return null;
    if (validateFlags) {
      const f = validateFlags(step.run);
      if (!f?.ok) return null;
    }
  }

  const primary = commands[0].run;
  const title = String(draft.title || primary).trim() || primary;
  let id = recipeSlugFromTitle(draft.id || title);
  if (!id) id = commandSlug(primary);

  const recipe = {
    id,
    title,
    commands,
    explanation: String(draft.explanation || `Runs \`${primary}\`.`).trim(),
    intent_family: '',
    simplicity_rank: commands.length > 1 ? 2 : 1,
    usage: normalizeUsage({
      command_line: primary,
      blurb: commands[0].comment || '',
    }, primary),
    topic: String(draft.topic || 'advanced').trim() || 'advanced',
    primary_example: primary,
    command: normalizeExample(draft.command || deriveCommandKey(primary)),
    source,
    step_signature: stepSignature(commands),
  };

  const check = validateRecipe(recipe, { validateFlags: validateFlags || undefined });
  if (!check.ok) return null;
  return recipe;
}

/**
 * Merge recipes by id + step_signature (shared first run is allowed).
 */
export function mergeRecipes(existing = [], incoming = []) {
  return mergeRecipesBySignature(existing, incoming);
}

/**
 * Are-you-sure expansion loops for recipes.
 */
export async function expandRecipesWithAreYouSure(recipes, {
  llmJson,
  schedule = (fn) => fn(),
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
  maxRounds = 5,
  minRecipes = 300,
  onRound = () => {},
} = {}) {
  if (!llmJson) throw new Error('llmJson required');
  let current = mergeRecipes([], recipes);
  const system = buildRecipeAreYouSureSystem(glossary);
  const rounds = [];
  let sure = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    const coverage = critiqueCoverage(current);
    let audit;
    try {
      audit = await schedule(() => llmJson({
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: JSON.stringify({
              are_you_sure: true,
              question: 'Are you sure this recipe catalog covers everyday + edge Git workflows?',
              min_recipes: minRecipes,
              max_additional_recipes: 8,
              current_count: current.length,
              topic_checklist: TOPIC_CHECKLIST,
              coverage_missing_topics: coverage.missing,
              // Keep payload small to avoid truncated JSON responses
              existing_primary_examples: current.map((r) => r.primary_example).slice(-120),
              sample_titles: current.map((r) => r.title).slice(-60),
              all_topics_present: [...new Set(current.map((r) => r.topic))],
              glossary,
            }),
          },
        ],
      }));
    } catch (err) {
      const roundInfo = {
        round,
        sure: false,
        rationale: `llm_error: ${err?.message || err}`,
        proposed: 0,
        added: 0,
        count: current.length,
        missing_topics: coverage.missing,
      };
      rounds.push(roundInfo);
      onRound(roundInfo);
      // One soft retry on the next loop iteration; stop if repeated failures
      if (rounds.filter((r) => String(r.rationale).startsWith('llm_error')).length >= 2) break;
      continue;
    }

    const addedRaw = Array.isArray(audit.additional_recipes) ? audit.additional_recipes : [];
    const added = [];
    for (const draft of addedRaw.slice(0, 8)) {
      const recipe = materializeAysRecipe(draft, { glossary, validateFlags, source: 'ays' });
      if (recipe) added.push(recipe);
    }
    current = mergeRecipes(current, added);
    const after = critiqueCoverage(current);
    const roundInfo = {
      round,
      sure: Boolean(audit.sure),
      rationale: audit.rationale || '',
      proposed: addedRaw.length,
      added: added.length,
      count: current.length,
      missing_topics: after.missing,
    };
    rounds.push(roundInfo);
    onRound(roundInfo);

    sure = Boolean(audit.sure) && current.length >= minRecipes && after.missing.length === 0;
    if (sure) break;
    if (added.length === 0 && after.missing.length === 0 && current.length >= minRecipes) {
      sure = true;
      break;
    }
    if (added.length === 0 && Boolean(audit.sure)) break;
  }

  return {
    recipes: current,
    sure,
    rounds,
    coverage: critiqueCoverage(current),
  };
}
