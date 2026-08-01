// @ts-nocheck
import type { SkillLevelText } from '../lib/skills.js';
import { normalizeSkillLevelText, SKILL_RANK } from '../lib/skills.js';
import { skillRankDistance } from './profile.js';

export type IntentHitLike = {
  command_id: number;
  skill_level_text?: string;
  skill_level?: number | string;
  intent_text?: string;
  intent_category?: string;
  _forcedScore?: number;
  score?: number;
  commands?: { command?: string; comment?: string }[];
  risk?: number;
  example?: string;
  snippet?: string;
  command_recipe?: string;
  [key: string]: unknown;
};

export type FtsHitLike = {
  command_id: number;
  bm25: number;
};

export type CollapsedCommand = {
  command_id: number;
  rawCosine: number | null;
  rawBm25: number | null;
  intent_text: string;
  intent_category: string;
  skill_level_text: string;
  commands: { command?: string; comment?: string }[];
  risk: number;
  example: string;
  snippet: string;
  command_recipe_json: string;
  stepCount: number;
};

function skillTextOf(hit: IntentHitLike): SkillLevelText {
  if (hit.skill_level_text) {
    return (normalizeSkillLevelText(hit.skill_level_text) ||
      hit.skill_level_text) as SkillLevelText;
  }
  return (normalizeSkillLevelText(hit.skill_level) || 'beginner') as SkillLevelText;
}

function cosineOf(hit: IntentHitLike): number {
  if (typeof hit._forcedScore === 'number') return hit._forcedScore;
  if (typeof hit.score === 'number') return hit.score;
  return 0;
}

/**
 * Pick best intent for a command given preferred skill (Q12-D):
 * exact skill â†’ closest rank â†’ highest similarity.
 */
export function pickIntentForCommand(
  intents: IntentHitLike[],
  preferredSkill: SkillLevelText | string,
): IntentHitLike {
  const pref = (normalizeSkillLevelText(preferredSkill) ||
    preferredSkill) as SkillLevelText;
  const exact = intents.filter((h) => skillTextOf(h) === pref);
  const pool = exact.length ? exact : intents;

  if (!exact.length) {
    let bestDist = Infinity;
    for (const h of intents) {
      const d = skillRankDistance(skillTextOf(h), pref);
      if (d < bestDist) bestDist = d;
    }
    const closest = intents.filter(
      (h) => skillRankDistance(skillTextOf(h), pref) === bestDist,
    );
    closest.sort((a, b) => cosineOf(b) - cosineOf(a));
    return closest[0]!;
  }

  pool.sort((a, b) => cosineOf(b) - cosineOf(a));
  return pool[0]!;
}

/**
 * Collapse intent KNN hits + FTS hits to one row per command_id.
 */
export function collapseToCommands(
  intentHits: IntentHitLike[],
  ftsHits: FtsHitLike[],
  preferredSkill: SkillLevelText | string,
): CollapsedCommand[] {
  const byCommand = new Map<number, IntentHitLike[]>();
  for (const h of intentHits) {
    const id = Number(h.command_id);
    if (!byCommand.has(id)) byCommand.set(id, []);
    byCommand.get(id)!.push(h);
  }

  const bm25ByCommand = new Map<number, number>();
  for (const f of ftsHits) {
    const id = Number(f.command_id);
    const prev = bm25ByCommand.get(id);
    // more negative = better; keep best (min)
    if (prev == null || f.bm25 < prev) bm25ByCommand.set(id, f.bm25);
  }

  const commandIds = new Set<number>([
    ...byCommand.keys(),
    ...bm25ByCommand.keys(),
  ]);

  const out: CollapsedCommand[] = [];
  for (const command_id of commandIds) {
    const intents = byCommand.get(command_id) ?? [];
    const picked = intents.length
      ? pickIntentForCommand(intents, preferredSkill)
      : null;
    const commands = picked?.commands ?? [];
    const recipeJson =
      typeof picked?.command_recipe === 'string'
        ? picked.command_recipe
        : JSON.stringify({ commands });
    out.push({
      command_id,
      rawCosine: picked ? cosineOf(picked) : null,
      rawBm25: bm25ByCommand.has(command_id)
        ? bm25ByCommand.get(command_id)!
        : null,
      intent_text: String(picked?.intent_text ?? ''),
      intent_category: String(picked?.intent_category ?? ''),
      skill_level_text: picked ? skillTextOf(picked) : '',
      commands,
      risk: Number(picked?.risk ?? 0),
      example: String(picked?.example ?? commands[0]?.command ?? ''),
      snippet: String(picked?.snippet ?? ''),
      command_recipe_json: recipeJson,
      stepCount: commands.length || 1,
    });
  }
  return out;
}
