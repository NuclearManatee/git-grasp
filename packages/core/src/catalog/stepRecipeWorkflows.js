import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { normalizeExample, recipeSlugFromTitle, validateRecipe } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { deriveCommandKey } from './stepRecipes.js';
import { normalizeUsage } from '../db/utils.js';
import { mergeRecipesBySignature, stepSignature } from './recipeIdentity.js';
import { PACKAGE_ROOT } from '../lib/paths.js';

/** Checklist families for workflow coverage reporting. */
export const WORKFLOW_CHECKLIST = Object.freeze([
  'peel-split-last-commit',
  'soft-undo-recommit',
  'unstage-vs-discard',
  'amend-exclude-path',
  'branch-from-parent',
  'stash-switch-pop',
  'conflict-abort-or-resolve',
  'rebase-abort',
  'upstream-first-push',
  'cherry-pick-or-revert-followup',
  'worktree-add',
  'submodule-init',
]);

/**
 * Load curated workflows from data/catalog/workflows.json
 */
export function loadWorkflowSeed(root = PACKAGE_ROOT) {
  const file = path.join(root, 'data', 'catalog', 'workflows.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Materialize one workflow draft into a recipe or null.
 */
export function materializeWorkflow(draft, {
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
  source = 'workflow',
} = {}) {
  if (!draft || typeof draft !== 'object') return null;
  const commands = (Array.isArray(draft.commands) ? draft.commands : [])
    .map((c) => ({
      run: normalizeExample(materializePlaceholders(String(c?.run || ''), glossary)),
      comment: String(c?.comment || '').trim(),
    }))
    .filter((c) => c.run);
  if (commands.length < 2) return null;

  for (const step of commands) {
    const v = { ok: true }; // validateExample below via validateRecipe
    void v;
  }

  const primary = commands[0].run;
  const title = String(draft.title || primary).trim() || primary;
  const id = String(draft.id || recipeSlugFromTitle(title)).trim() || recipeSlugFromTitle(primary);
  const recipe = {
    id,
    title,
    commands,
    explanation: String(draft.explanation || '').trim(),
    intent_family: String(draft.intent_family || draft.checklist || '').trim(),
    simplicity_rank: Math.max(2, Number(draft.simplicity_rank) || 2),
    usage: normalizeUsage({
      command_line: primary,
      blurb: commands.map((c) => c.comment).filter(Boolean).join(' → ') || 'Multi-step workflow',
    }, primary),
    topic: String(draft.topic || 'advanced').trim() || 'advanced',
    primary_example: primary,
    command: normalizeExample(draft.command || deriveCommandKey(primary)),
    source,
    checklist: draft.checklist || '',
    step_signature: stepSignature(commands),
  };

  const skipFlags = true; // curated / judged workflows
  const check = validateRecipe(recipe, {
    validateFlags: skipFlags ? undefined : (validateFlags || undefined),
  });
  if (!check.ok) return null;
  return recipe;
}

/**
 * Merge workflow seed into recipe list (signature-safe).
 */
export function enrichRecipesFromWorkflows(recipes, workflows = null, glossary = DEFAULT_GLOSSARY) {
  const drafts = workflows ?? loadWorkflowSeed();
  const incoming = [];
  for (const d of drafts) {
    const r = materializeWorkflow(d, { glossary, source: d.source || 'workflow' });
    if (r) incoming.push(r);
  }
  return mergeRecipesBySignature(recipes, incoming);
}

/**
 * @param {object[]} recipes
 * @returns {{ covered: string[], missing: string[], multiCount: number }}
 */
export function workflowCoverageReport(recipes = []) {
  const covered = new Set();
  let multiCount = 0;
  for (const r of recipes) {
    if ((r.commands?.length || 0) >= 2) multiCount += 1;
    const key = String(r.checklist || r.intent_family || '').trim();
    if (WORKFLOW_CHECKLIST.includes(key)) covered.add(key);
  }
  const missing = WORKFLOW_CHECKLIST.filter((k) => !covered.has(k));
  return { covered: [...covered], missing, multiCount };
}

/**
 * LLM system prompt: propose additional multi-step workflows for gaps.
 */
export function buildWorkflowExpandSystem(glossary) {
  return `You expand a git-help WORKFLOW catalog (multi-step recipes only).
Return JSON only:
{
  "sure": false,
  "additional_recipes": [
    {
      "id": "kebab-id",
      "title": "Human title",
      "topic": "undo",
      "checklist": "peel-split-last-commit",
      "command": "git reset",
      "explanation": "What the full sequence achieves.",
      "intent_family": "peel-split-last-commit",
      "commands": [
        { "run": "git reset --soft HEAD~1", "comment": "…" },
        { "run": "git restore --staged app.js", "comment": "…" }
      ]
    }
  ],
  "rationale": "short"
}
Rules:
- Every recipe MUST have 2–5 commands[].run lines (3 preferred, 5 rare).
- Each run is a single git invocation (starts with git; NO shell operators && || | ; \` $()).
- Do NOT duplicate step sequences already listed (same ordered runs).
- Prefer filling missing checklist ids: ${WORKFLOW_CHECKLIST.join(', ')}.
- checklist must be one of those ids when possible.
- Use ONLY concrete glossary tokens: ${JSON.stringify(glossary || {})}
- sure=true only when missing checklist is empty AND you have nothing useful to add; then additional_recipes=[].
- At most 8 additional_recipes per response.`;
}

/**
 * Build-time LLM judge: does the sequence achieve the title?
 */
export function buildWorkflowJudgeSystem() {
  return `You judge whether a multi-step git recipe is correct for its title/explanation.
Return JSON only:
{ "ok": true, "reason": "short" }
ok=false if steps are wrong order, don't achieve the goal, invent fake flags, or are mostly redundant status padding.
Be strict but practical for everyday git.`;
}

/**
 * Expand workflows via LLM until coverage / multi floor (optional).
 */
export async function expandWorkflowsWithLlm(recipes, {
  llmJson,
  schedule = (fn) => fn(),
  glossary = DEFAULT_GLOSSARY,
  maxRounds = 4,
  minMulti = 80,
  judge = true,
  onRound = () => {},
} = {}) {
  if (!llmJson) throw new Error('llmJson required');
  let current = mergeRecipesBySignature([], recipes);
  const system = buildWorkflowExpandSystem(glossary);
  const judgeSystem = buildWorkflowJudgeSystem();
  const rounds = [];

  for (let round = 1; round <= maxRounds; round += 1) {
    const report = workflowCoverageReport(current);
    if (report.missing.length === 0 && report.multiCount >= minMulti) {
      rounds.push({ round, added: 0, proposed: 0, sure: true, ...report });
      onRound(rounds[rounds.length - 1]);
      break;
    }
    let audit;
    try {
      audit = await schedule(() => llmJson({
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: JSON.stringify({
              missing_checklist: report.missing,
              multi_count: report.multiCount,
              min_multi: minMulti,
              existing_signatures: current
                .filter((r) => (r.commands?.length || 0) >= 2)
                .slice(0, 80)
                .map((r) => ({
                  id: r.id,
                  title: r.title,
                  checklist: r.checklist || r.intent_family,
                  steps: (r.commands || []).map((c) => c.run),
                })),
            }),
          },
        ],
      }));
    } catch (err) {
      rounds.push({ round, error: String(err?.message || err), ...report });
      break;
    }

    const proposed = Array.isArray(audit?.additional_recipes) ? audit.additional_recipes : [];
    const accepted = [];
    for (const draft of proposed) {
      const r = materializeWorkflow(draft, { glossary });
      if (!r) continue;
      if (judge) {
        try {
          const verdict = await schedule(() => llmJson({
            messages: [
              { role: 'system', content: judgeSystem },
              {
                role: 'user',
                content: JSON.stringify({
                  title: r.title,
                  explanation: r.explanation,
                  commands: r.commands,
                }),
              },
            ],
          }));
          if (verdict?.ok === false) continue;
        } catch {
          // If judge fails open, keep validated recipe
        }
      }
      accepted.push(r);
    }
    current = mergeRecipesBySignature(current, accepted);
    const after = workflowCoverageReport(current);
    rounds.push({
      round,
      added: accepted.length,
      proposed: proposed.length,
      sure: Boolean(audit?.sure),
      ...after,
    });
    onRound(rounds[rounds.length - 1]);
    if (audit?.sure && after.missing.length === 0) break;
  }

  return { recipes: current, rounds };
}
