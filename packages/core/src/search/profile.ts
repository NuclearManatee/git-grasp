import type { SkillLevelText } from '../lib/skills.js';
import { normalizeSkillLevelText, SKILL_RANK } from '../lib/skills.js';

export type BlendBucket = 'novice' | 'expert';

export type QueryProfile = {
  preferredSkill: SkillLevelText;
  alpha: number;
  beta: number;
  blendBucket: BlendBucket;
};

const SOFT_GIT_WORDS = new Set([
  'commit',
  'commits',
  'branch',
  'branches',
  'merge',
  'merged',
  'push',
  'pull',
  'clone',
  'repo',
  'repository',
  'stage',
  'staged',
  'staging',
  'unstage',
  'checkout',
  'revert',
  'undo',
  'history',
  'remote',
  'upstream',
  'conflict',
  'conflicts',
  'diff',
  'log',
  'tag',
  'tags',
  'stash',
  'rebase',
  'cherry',
  'pick',
  'reset',
  'head',
  'origin',
  'working',
  'tree',
  'index',
]);

/**
 * Map skill level to hybrid blend weights.
 * novice bucket: nontechnical|beginner → α=0.70
 * expert bucket: intermediate|expert → α=0.30
 */
export function blendWeightsForSkill(skill: SkillLevelText): {
  alpha: number;
  beta: number;
  blendBucket: BlendBucket;
} {
  const bucket: BlendBucket =
    skill === 'nontechnical' || skill === 'beginner' ? 'novice' : 'expert';
  const alpha = bucket === 'novice' ? 0.7 : 0.3;
  const beta = bucket === 'novice' ? 0.3 : 0.7;
  return { alpha, beta, blendBucket: bucket };
}

function tokenize(query: string): string[] {
  return String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9_+-]+/i)
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasFlagToken(query: string): boolean {
  return /(?:^|\s)--?[A-Za-z]/.test(query);
}

/**
 * Heuristic 4-level skill when config is unset.
 */
export function heuristicSkillLevel(
  query: string,
  verbs: readonly string[] = [],
): SkillLevelText {
  const q = String(query || '');
  if (hasFlagToken(q)) return 'expert';

  const verbSet = new Set(verbs.map((v) => String(v).toLowerCase()));
  const tokens = tokenize(q);
  const hasAllowlisted = tokens.some(
    (t) => verbSet.has(t) || (t === 'git' ? false : verbSet.has(t.replace(/^git/, ''))),
  );
  // Also match tokens that are exactly in verbs (status, rebase, …)
  if (tokens.some((t) => verbSet.has(t))) return 'intermediate';

  const hasSoft = tokens.some((t) => SOFT_GIT_WORDS.has(t));
  if (hasSoft) return 'beginner';
  if (hasAllowlisted) return 'intermediate';
  return 'nontechnical';
}

/**
 * Resolve preferred skill + α/β for a query.
 * Explicit preferredSkill always wins over heuristic.
 */
export function profileQuery(
  query: string,
  opts: {
    preferredSkill?: SkillLevelText | number | string | null;
    verbs?: readonly string[];
  } = {},
): QueryProfile {
  let preferred: SkillLevelText | null = null;
  if (opts.preferredSkill != null && opts.preferredSkill !== '') {
    if (typeof opts.preferredSkill === 'number') {
      preferred = normalizeSkillLevelText(opts.preferredSkill);
    } else {
      preferred = normalizeSkillLevelText(opts.preferredSkill);
    }
  }
  if (!preferred) {
    preferred = heuristicSkillLevel(query, opts.verbs ?? []);
  }
  const weights = blendWeightsForSkill(preferred);
  return {
    preferredSkill: preferred,
    ...weights,
  };
}

/** Closest skill rank distance for Q12-D. */
export function skillRankDistance(
  a: SkillLevelText | string | number,
  b: SkillLevelText | string | number,
): number {
  const ra =
    typeof a === 'number'
      ? a
      : SKILL_RANK[normalizeSkillLevelText(a) as SkillLevelText] ?? 99;
  const rb =
    typeof b === 'number'
      ? b
      : SKILL_RANK[normalizeSkillLevelText(b) as SkillLevelText] ?? 99;
  return Math.abs(ra - rb);
}
