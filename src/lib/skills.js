/**
 * Skill levels: INT for ordering/filtering, names for CLI/LLM/UX.
 * Order: non-technical < beginner < intermediate < expert
 */
export const SKILL_MIN = 1;
export const SKILL_MAX = 4;

/** @type {Readonly<Record<string, number>>} */
export const SKILL_BY_NAME = Object.freeze({
  'non-technical': 1,
  beginner: 2,
  intermediate: 3,
  expert: 4,
});

/** @type {Readonly<Record<number, string>>} */
export const SKILL_BY_LEVEL = Object.freeze({
  1: 'non-technical',
  2: 'beginner',
  3: 'intermediate',
  4: 'expert',
});

export const SKILL_NAMES = Object.freeze(Object.keys(SKILL_BY_NAME));

/**
 * @param {unknown} input
 * @returns {number | null} null means clear/off; throws on invalid
 */
export function parseSkillLevel(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (s === 'clear' || s === 'off' || s === '') return null;
  if (Object.prototype.hasOwnProperty.call(SKILL_BY_NAME, s)) {
    return SKILL_BY_NAME[s];
  }
  const n = Number(s);
  if (Number.isInteger(n) && n >= SKILL_MIN && n <= SKILL_MAX) return n;
  throw new Error(
    `skillLevel must be ${SKILL_NAMES.join('|')}|${SKILL_MIN}-${SKILL_MAX}|clear|off`,
  );
}

/**
 * @param {number} level
 * @returns {string}
 */
export function skillName(level) {
  const n = Number(level);
  return SKILL_BY_LEVEL[n] || String(level);
}

/**
 * At-most filter: row is visible when rowLevel <= maxLevel.
 * @param {number} rowLevel
 * @param {number | null | undefined} maxLevel
 */
export function skillAtMost(rowLevel, maxLevel) {
  if (maxLevel == null) return true;
  return Number(rowLevel) <= Number(maxLevel);
}

/**
 * @param {unknown} level
 */
export function isValidSkillLevel(level) {
  const n = Number(level);
  return Number.isInteger(n) && n >= SKILL_MIN && n <= SKILL_MAX;
}

/**
 * Parse expectedSkillBand entry (number or name) → int.
 * @param {unknown} v
 */
export function coerceSkillBandValue(v) {
  if (typeof v === 'number' && Number.isInteger(v)) {
    // Migration: old 1–5 bands clamp into 1–4
    if (v >= 1 && v <= 4) return v;
    if (v === 5) return 4;
    throw new Error(`invalid skill band value: ${v}`);
  }
  return parseSkillLevel(v);
}

/**
 * Prompt snippet listing skills for LLM writers.
 */
export function skillPromptList() {
  return SKILL_NAMES.map((name) => `${SKILL_BY_NAME[name]}=${name}`).join(', ');
}
