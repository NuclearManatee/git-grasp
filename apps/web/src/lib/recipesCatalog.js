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

/**
 * @param {object[]} [recipes]
 * @returns {{ tag: string, count: number }[]}
 */
export function listTags(recipes = loadRecipes()) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const r of recipes) {
    const tag = String(r.topic || 'untagged').toLowerCase();
    counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * @param {string} tag
 * @param {object[]} [recipes]
 */
export function recipesForTag(tag, recipes = loadRecipes()) {
  if (tag === 'all') return recipes;
  const key = String(tag).toLowerCase();
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
    simplicity: r.simplicity_rank ?? 1,
    explanation: r.explanation || '',
    steps: Array.isArray(r.commands)
      ? r.commands.map((c) => ({ run: c.run, comment: c.comment || '' }))
      : [{ run: r.primary_example || r.command || '', comment: '' }],
    usage: parseUsage(r.usage, r.primary_example),
    primary: r.primary_example || '',
  }));
}
