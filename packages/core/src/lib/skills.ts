/**
 * Skill levels as TEXT enums (schema v6).
 * Order: nontechnical < beginner < intermediate < expert
 */

export const SKILL_LEVELS = Object.freeze([
  'nontechnical',
  'beginner',
  'intermediate',
  'expert',
] as const);

export type SkillLevelText = (typeof SKILL_LEVELS)[number];

/** @deprecated numeric bands — prefer TEXT enums */
export const SKILL_MIN = 1;
export const SKILL_MAX = 4;

const ALIASES: Record<string, SkillLevelText> = {
  nontechnical: 'nontechnical',
  'non-technical': 'nontechnical',
  beginner: 'beginner',
  intermediate: 'intermediate',
  expert: 'expert',
};

/** Numeric rank for at-most filtering (lower = less skilled). */
export const SKILL_RANK: Readonly<Record<SkillLevelText, number>> = Object.freeze({
  nontechnical: 1,
  beginner: 2,
  intermediate: 3,
  expert: 4,
});

/** @deprecated use SKILL_RANK / TEXT enums */
export const SKILL_BY_NAME = Object.freeze({
  nontechnical: 1,
  'non-technical': 1,
  beginner: 2,
  intermediate: 3,
  expert: 4,
});

/** @deprecated */
export const SKILL_BY_LEVEL = Object.freeze({
  1: 'nontechnical',
  2: 'beginner',
  3: 'intermediate',
  4: 'expert',
});

export const SKILL_NAMES = Object.freeze([...SKILL_LEVELS]);

export function normalizeSkillLevelText(input: unknown): SkillLevelText | null {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'clear' || s === 'off' || s === '') return null;
  if (Object.prototype.hasOwnProperty.call(ALIASES, s)) {
    return ALIASES[s]!;
  }
  const n = Number(s);
  if (Number.isInteger(n) && n >= SKILL_MIN && n <= SKILL_MAX) {
    return SKILL_BY_LEVEL[n as 1 | 2 | 3 | 4] as SkillLevelText;
  }
  throw new Error(
    `skillLevel must be ${SKILL_LEVELS.join('|')}|${SKILL_MIN}-${SKILL_MAX}|clear|off`,
  );
}

/**
 * @param {unknown} input
 * @returns {number | null} null means clear/off; throws on invalid
 * @deprecated prefer normalizeSkillLevelText
 */
export function parseSkillLevel(input: unknown): number | null {
  const t = normalizeSkillLevelText(input);
  if (t == null) return null;
  return SKILL_RANK[t];
}

export function skillName(level: unknown): string {
  if (typeof level === 'string') {
    try {
      return normalizeSkillLevelText(level) || String(level);
    } catch {
      return String(level);
    }
  }
  const n = Number(level);
  return (SKILL_BY_LEVEL as Record<number, string>)[n] || String(level);
}

/**
 * At-most filter: row is visible when row rank <= max rank.
 */
export function skillAtMost(
  rowLevel: unknown,
  maxLevel: unknown,
): boolean {
  if (maxLevel == null) return true;
  const row =
    typeof rowLevel === 'string'
      ? SKILL_RANK[normalizeSkillLevelText(rowLevel) as SkillLevelText]
      : Number(rowLevel);
  const max =
    typeof maxLevel === 'string'
      ? SKILL_RANK[normalizeSkillLevelText(maxLevel) as SkillLevelText]
      : Number(maxLevel);
  return row <= max;
}

export function isValidSkillLevel(level: unknown): boolean {
  try {
    if (typeof level === 'string') {
      return normalizeSkillLevelText(level) != null;
    }
    const n = Number(level);
    return Number.isInteger(n) && n >= SKILL_MIN && n <= SKILL_MAX;
  } catch {
    return false;
  }
}

export function coerceSkillBandValue(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v)) {
    if (v >= 1 && v <= 4) return v;
    if (v === 5) return 4;
    throw new Error(`invalid skill band value: ${v}`);
  }
  const n = parseSkillLevel(v);
  if (n == null) throw new Error(`invalid skill band value: ${v}`);
  return n;
}

export function skillPromptList(): string {
  return SKILL_LEVELS.join(', ');
}

export const INTENT_CATEGORIES = Object.freeze([
  'goal',
  'error_message',
  'symptom',
  'conversational',
] as const);

export type IntentCategoryText = (typeof INTENT_CATEGORIES)[number];
