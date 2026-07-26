import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve recipes.json whether Astro runs from repo root or apps/web.
 * Avoid import.meta.url — Vite prerender rewrites it to the chunk path.
 */
function recipesPath() {
  const candidates = [
    path.join(process.cwd(), 'data', 'catalog', 'recipes.json'),
    path.join(process.cwd(), '..', '..', 'data', 'catalog', 'recipes.json'),
    path.join(process.cwd(), '..', 'data', 'catalog', 'recipes.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `recipes.json not found (cwd=${process.cwd()}). Tried:\n${candidates.join('\n')}`,
  );
}

/**
 * @returns {object[]}
 */
export function loadRecipes() {
  return JSON.parse(readFileSync(recipesPath(), 'utf8'));
}

export function stepCount(r) {
  if (Array.isArray(r.commands) && r.commands.length) return r.commands.length;
  return 1;
}

export function isMultiStep(r) {
  return stepCount(r) >= 2;
}

/**
 * @param {object[]} [recipes]
 */
export function catalogStats(recipes = loadRecipes()) {
  const multi = recipes.filter(isMultiStep);
  return {
    total: recipes.length,
    multi: multi.length,
    single: recipes.length - multi.length,
    multiPct: recipes.length ? Math.round((100 * multi.length) / recipes.length) : 0,
  };
}

/**
 * @param {object[]} [recipes]
 * @returns {{ tag: string, count: number, multi: number }[]}
 */
export function listTags(recipes = loadRecipes()) {
  /** @type {Map<string, { count: number, multi: number }>} */
  const counts = new Map();
  for (const r of recipes) {
    const tag = String(r.topic || 'untagged').toLowerCase();
    const cur = counts.get(tag) || { count: 0, multi: 0 };
    cur.count += 1;
    if (isMultiStep(r)) cur.multi += 1;
    counts.set(tag, cur);
  }
  return [...counts.entries()]
    .map(([tag, v]) => ({ tag, count: v.count, multi: v.multi }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Reserved pseudo-tags for assessment browsing.
 */
export const SPECIAL_TAGS = Object.freeze(['all', 'multi', 'single', 'workflow']);

/**
 * @param {string} tag
 * @param {object[]} [recipes]
 */
export function recipesForTag(tag, recipes = loadRecipes()) {
  const key = String(tag).toLowerCase();
  if (key === 'all') return recipes;
  if (key === 'multi') return recipes.filter(isMultiStep);
  if (key === 'single') return recipes.filter((r) => !isMultiStep(r));
  if (key === 'workflow') return recipes.filter((r) => String(r.source || '') === 'workflow');
  return recipes.filter((r) => String(r.topic || 'untagged').toLowerCase() === key);
}

/**
 * @param {string} usage
 * @param {string} [fallback]
 */
function parseUsage(usage, fallback) {
  const raw = String(usage || '').trim();
  if (!raw) return { commandLine: fallback || '', blurb: '' };
  const parts = raw.split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { commandLine: parts[0], blurb: parts.slice(1).join(' ') };
  if (/^git(\s|$)/.test(parts[0])) return { commandLine: parts[0], blurb: '' };
  return { commandLine: fallback || '', blurb: parts[0] || '' };
}

/**
 * Slim payload for the client carousel.
 * @param {object[]} recipes
 */
export function toCarouselPayload(recipes) {
  return recipes.map((r) => ({
    id: r.id,
    title: r.title || r.command,
    command: r.command,
    topic: r.topic || '',
    source: r.source || '',
    family: r.intent_family || '',
    checklist: r.checklist || '',
    simplicity: r.simplicity_rank ?? 1,
    stepCount: stepCount(r),
    explanation: r.explanation || '',
    steps: Array.isArray(r.commands)
      ? r.commands.map((c) => ({ run: c.run, comment: c.comment || '' }))
      : [{ run: r.primary_example || r.command || '', comment: '' }],
    usage: parseUsage(r.usage, r.primary_example),
    primary: r.primary_example || '',
  }));
}
