import { normalizeExample } from '../lib/validator.js';

const FAMILY_SYSTEM = `You assign intent families and relative simplicity ranks for git recipes.
Return JSON only:
{
  "items": [
    {
      "id": "undo-last-commit-keep-changes",
      "intent_family": "soft-undo",
      "simplicity_rank": 1
    }
  ]
}
Rules:
- intent_family groups recipes that answer the SAME user goal (kebab-case).
- simplicity_rank is an integer WITHIN that family only: 1 = simplest/easiest for most users.
- Single-step everyday porcelain usually ranks simpler than multi-step workflows.
- You MUST return one item per input id (match id string exactly).
- Do not invent new recipes.`;

/**
 * Assign intent_family + simplicity_rank for a batch of recipes.
 */
export async function assignRecipeFamiliesForBatch(recipes, { llmJson, schedule }) {
  if (!recipes?.length) return [];
  if (!llmJson) throw new Error('llmJson required');
  const payload = recipes.map((r) => ({
    id: r.id,
    title: r.title,
    command: r.command,
    primary_example: r.primary_example,
    steps: Array.isArray(r.commands) ? r.commands.length : 1,
  }));
  const out = await schedule(() => llmJson({
    messages: [
      { role: 'system', content: FAMILY_SYSTEM },
      { role: 'user', content: JSON.stringify({ recipes: payload }) },
    ],
  }));
  const byId = new Map();
  for (const item of out.items || []) {
    if (!item?.id) continue;
    byId.set(item.id, {
      intent_family: String(item.intent_family || '').trim() || 'general',
      simplicity_rank: Math.max(1, Number(item.simplicity_rank) || 1),
    });
  }
  return recipes.map((r) => {
    const meta = byId.get(r.id);
    return {
      ...r,
      intent_family: meta?.intent_family || fallbackFamily(r),
      simplicity_rank: meta?.simplicity_rank || r.simplicity_rank || 1,
    };
  });
}

function fallbackFamily(r) {
  const ex = normalizeExample(r.primary_example || r.command || r.id);
  const parts = ex.split(/\s+/);
  if (parts.length >= 2) return parts.slice(0, 2).join('-').replace(/^git-/, '');
  return 'general';
}

/**
 * Heuristic family/simplicity when LLM unavailable.
 */
export function assignRecipeFamiliesHeuristic(recipes = []) {
  const withFam = recipes.map((r) => ({
    ...r,
    intent_family: r.intent_family || fallbackFamily(r),
  }));
  const byFamily = new Map();
  for (const r of withFam) {
    if (!byFamily.has(r.intent_family)) byFamily.set(r.intent_family, []);
    byFamily.get(r.intent_family).push(r);
  }
  const ranked = [];
  for (const [, group] of byFamily) {
    const sorted = [...group].sort((a, b) => {
      const stepsA = Array.isArray(a.commands) ? a.commands.length : 1;
      const stepsB = Array.isArray(b.commands) ? b.commands.length : 1;
      if (stepsA !== stepsB) return stepsA - stepsB;
      return String(a.primary_example).length - String(b.primary_example).length;
    });
    sorted.forEach((r, i) => {
      ranked.push({ ...r, simplicity_rank: r.simplicity_rank || i + 1 });
    });
  }
  return ranked;
}
