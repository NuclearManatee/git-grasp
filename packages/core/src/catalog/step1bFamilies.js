import { normalizeExample } from '../lib/validator.js';

const FAMILY_SYSTEM = `You assign intent families and relative simplicity ranks for git command examples.
Return JSON only:
{
  "items": [
    {
      "example": "git branch --show-current",
      "intent_family": "show-current-branch",
      "simplicity_rank": 1
    }
  ]
}
Rules:
- intent_family groups examples that answer the SAME user goal (kebab-case).
- simplicity_rank is an integer WITHIN that family only: 1 = simplest/easiest for most users.
- Porcelain usually ranks simpler than plumbing (rev-parse, symbolic-ref, update-ref).
- Fewer flags / shorter everyday forms rank simpler when goals match.
- You MUST return one item per input example (match example string exactly).
- Do not invent new examples.`;

/**
 * Assign intent_family + simplicity_rank for a batch of example rows.
 */
export async function assignFamiliesForBatch(examples, { llmJson, schedule }) {
  if (!examples?.length) return [];
  const jsonFn = llmJson;
  if (!jsonFn) throw new Error('llmJson required');
  const payload = examples.map((e) => ({
    command: e.command,
    example: e.example,
    topic: e.topic,
  }));
  const out = await schedule(() => jsonFn({
    messages: [
      { role: 'system', content: FAMILY_SYSTEM },
      { role: 'user', content: JSON.stringify({ examples: payload }) },
    ],
  }));
  const byExample = new Map();
  for (const item of out.items || []) {
    if (!item?.example) continue;
    byExample.set(normalizeExample(item.example), {
      intent_family: String(item.intent_family || '').trim() || 'general',
      simplicity_rank: Math.max(1, Number(item.simplicity_rank) || 1),
    });
  }
  return examples.map((e) => {
    const key = normalizeExample(e.example);
    const meta = byExample.get(key);
    return {
      ...e,
      intent_family: meta?.intent_family || fallbackFamily(e),
      simplicity_rank: meta?.simplicity_rank || 1,
    };
  });
}

function fallbackFamily(e) {
  const parts = normalizeExample(e.example).split(/\s+/);
  if (parts.length >= 2) return parts.slice(0, 2).join('-').replace(/^git-/, '');
  return 'general';
}

/**
 * Heuristic family/simplicity when LLM unavailable (tests / offline).
 */
export function assignFamiliesHeuristic(examples = []) {
  const byFamily = new Map();
  const withFam = examples.map((e) => {
    const intent_family = e.intent_family || fallbackFamily(e);
    return { ...e, intent_family };
  });
  for (const e of withFam) {
    if (!byFamily.has(e.intent_family)) byFamily.set(e.intent_family, []);
    byFamily.get(e.intent_family).push(e);
  }
  const ranked = [];
  for (const [, group] of byFamily) {
    const sorted = [...group].sort(
      (a, b) => specificity(a.example) - specificity(b.example)
        || a.example.localeCompare(b.example),
    );
    sorted.forEach((e, i) => {
      ranked.push({ ...e, simplicity_rank: e.simplicity_rank || i + 1 });
    });
  }
  return ranked;
}

function specificity(example) {
  return String(example || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Process all examples in topic-sized batches.
 */
export async function assignFamiliesAll(examples, {
  llmJson,
  schedule,
  batchSize = 40,
  onBatch = () => {},
} = {}) {
  if (!llmJson) return assignFamiliesHeuristic(examples);
  const byTopic = new Map();
  for (const e of examples) {
    const t = e.topic || 'advanced';
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(e);
  }
  const out = [];
  for (const [topic, list] of byTopic) {
    for (let i = 0; i < list.length; i += batchSize) {
      const chunk = list.slice(i, i + batchSize);
      const assigned = await assignFamiliesForBatch(chunk, { llmJson, schedule });
      out.push(...assigned);
      onBatch({ topic, done: out.length, total: examples.length });
    }
  }
  return out;
}

export { FAMILY_SYSTEM };
