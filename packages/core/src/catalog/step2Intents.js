import { makeRowId, normalizeExample } from '../lib/validator.js';
import { estimateTokensFromMessages } from '../lib/rateLimit.js';
import { skillPromptList, SKILL_BY_NAME, SKILL_NAMES, isValidSkillLevel } from '../lib/skills.js';
import { DEFAULT_GLOSSARY } from './step0Glossary.js';
import { normalizeUsage } from '../db/utils.js';

/**
 * @param {object} entry example row with command, example, family, simplicity
 * @param {{ common?: boolean }} opts
 */
export function intentCountForExample(entry, opts = {}) {
  const common = opts.common
    || Number(entry.simplicity_rank) === 1
    || entry.source_hint === 'essential'
    || /^(git status|git commit|git branch|git push|git pull|git stash|git log|git diff|git add)\b/.test(entry.command || '');
  return common ? 5 : 3;
}

export function buildIntentWriterSystem(glossary) {
  return `You are the git-help INTENT WRITER.
Given ONE pasteable git example, produce skill-level intent variants and help fields.
Skill levels (use names in output): ${skillPromptList()}.
Return JSON only:
{
  "command": "git commit",
  "example": "git commit --amend --no-edit",
  "explanation": "how it works; mention important caveats in prose when relevant (no separate risk field)",
  "usage": {
    "command_line": "git commit --amend",
    "blurb": "Rewrites the previous commit to include staged changes."
  },
  "intents": [
    {
      "skill_level": "beginner",
      "intent_descriptions": [
        "add files to my last commit",
        "fix the previous commit without changing the message"
      ]
    }
  ]
}
Rules:
- Cover ALL four skills: ${SKILL_NAMES.join(', ')}.
- Per skill: provide intent_descriptions array (natural language; no shell operators).
- Diversity: D1 paraphrases + D2 colloquial/non-git wording required; D4 misconception phrasings sparse (at most one per skill).
- Tone matches skill name (non-technical colloquial → expert technical).
- usage.command_line: short doc-style form (glossary concretes, slightly shorter than full example when sensible).
- usage.blurb: ONE short sentence explaining what that usage does (git-docs style).
- Do not invent a different example; stay faithful to the given example.
- Do NOT output risk_class or risks fields.
- Glossary (context only): ${JSON.stringify(glossary || DEFAULT_GLOSSARY)}`;
}

function coerceSkill(level) {
  if (typeof level === 'string') {
    const key = level.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SKILL_BY_NAME, key)) return SKILL_BY_NAME[key];
  }
  const n = Number(level);
  return isValidSkillLevel(n) ? n : null;
}

function rowsFromItem(entry, item, { intentTarget = 3 } = {}) {
  const explanation = item.explanation || `${entry.example} (${entry.topic || 'git'})`;
  const example = normalizeExample(item.example || entry.example || entry.command);
  const command = entry.command || item.command || example;
  const usage = normalizeUsage(item.usage || entry.usage, example);
  const intents = Array.isArray(item.intents) ? item.intents : [];
  const rows = [];
  for (const intent of intents) {
    if (intent.skill_level_na) continue;
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
        id: makeRowId(example, level, idx),
        command,
        example,
        usage,
        intent_family: entry.intent_family || '',
        simplicity_rank: Number(entry.simplicity_rank ?? 1),
        skill_level: level,
        intent_description: String(desc).trim(),
        explanation,
        topic: entry.topic || 'advanced',
      });
      idx += 1;
    }
  }
  return rows;
}

/**
 * ONE example → ONE LLM call.
 */
export async function generateIntentsForExample(entry, {
  llmJson,
  groqJson,
  schedule,
  glossary = DEFAULT_GLOSSARY,
  common = false,
} = {}) {
  const jsonFn = llmJson || groqJson;
  if (!jsonFn) throw new Error('llmJson (or groqJson) required');
  const intentTarget = intentCountForExample(entry, { common });
  const messages = [
    { role: 'system', content: buildIntentWriterSystem(glossary) },
    {
      role: 'user',
      content: JSON.stringify({
        command: entry.command,
        example: entry.example,
        topic: entry.topic,
        intent_family: entry.intent_family,
        simplicity_rank: entry.simplicity_rank,
        intent_count_per_skill: intentTarget,
        diversity: {
          required: ['D1_paraphrase', 'D2_colloquial'],
          sparse: ['D4_misconception'],
        },
      }),
    },
  ];
  const estimatedTokens = estimateTokensFromMessages(messages) + 1800;
  const out = await schedule(() => jsonFn({ messages }), { estimatedTokens });
  const item = Array.isArray(out.items) ? (out.items[0] || out) : out;
  return rowsFromItem(entry, item, { intentTarget });
}

/** @deprecated use generateIntentsForExample */
export async function generateIntentsForCommand(entry, deps) {
  const exampleEntry = {
    ...entry,
    example: entry.example || entry.command,
  };
  return generateIntentsForExample(exampleEntry, deps);
}

export { rowsFromItem };
