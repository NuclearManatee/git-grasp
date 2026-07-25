import { makeRowId } from '../lib/validator.js';
import { estimateTokensFromMessages } from '../lib/rateLimit.js';

const INTENT_WRITER_SYSTEM = `You are the git-help INTENT WRITER (not the extractor).
Given ONE git command, produce skill-level intent variants and verbose help fields.
Return JSON only:
{
  "command": "git status",
  "risk_class": "none|low|high|destructive",
  "explanation": "how it works",
  "risks": "side effects",
  "examples": "example usage",
  "intents": [
    { "skill_level": 1, "intent_description": "beginner phrasing", "skill_level_na": false },
    { "skill_level": 2, "intent_description": "..." },
    { "skill_level": 3, "intent_description": "..." },
    { "skill_level": 4, "intent_description": "..." },
    { "skill_level": 5, "intent_description": "expert phrasing" }
  ]
}
Rules:
- Prefer all 5 levels. Set skill_level_na true only when a level truly does not apply.
- intent_description must be natural language; no shell operators.
- Match tone: 1=noob colloquial, 5=pro/technical.`;

function rowsFromItem(entry, item) {
  const risk_class = item.risk_class || entry.risk_class || 'none';
  const explanation = item.explanation || `${entry.command} (${entry.topic || 'git'})`;
  const risks = item.risks || '';
  const examples = item.examples || entry.command;
  const intents = Array.isArray(item.intents) ? item.intents : [];
  const rows = [];
  for (const intent of intents) {
    const level = Number(intent.skill_level);
    if (intent.skill_level_na) continue;
    if (!Number.isInteger(level) || level < 1 || level > 5) continue;
    if (!intent.intent_description) continue;
    rows.push({
      id: makeRowId(entry.command, level),
      command: entry.command,
      skill_level: level,
      intent_description: String(intent.intent_description).trim(),
      explanation,
      risks,
      examples,
      risk_class,
      topic: entry.topic || 'advanced',
    });
  }
  return rows;
}

/**
 * ONE command → ONE LLM call (no batching of multiple commands).
 * @param {object} entry
 * @param {{ llmJson?: Function, groqJson?: Function, schedule: Function }} deps
 */
export async function generateIntentsForCommand(entry, { llmJson, groqJson, schedule }) {
  const jsonFn = llmJson || groqJson;
  if (!jsonFn) throw new Error('llmJson (or groqJson) required');
  const messages = [
    { role: 'system', content: INTENT_WRITER_SYSTEM },
    {
      role: 'user',
      content: JSON.stringify({
        command: entry.command,
        topic: entry.topic,
        risk_class_hint: entry.risk_class,
      }),
    },
  ];
  const estimatedTokens = estimateTokensFromMessages(messages) + 1200; // reply budget
  const out = await schedule(() => jsonFn({ messages }), { estimatedTokens });
  // Support both flat and items[0] shapes
  const item = Array.isArray(out.items) ? (out.items[0] || out) : out;
  return rowsFromItem(entry, item);
}
