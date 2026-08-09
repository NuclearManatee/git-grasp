// @ts-nocheck
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { CommandRecipeSchema } from '@git-grasp/common/schemas';

const CatalogCommandSchema = z
  .object({
    row_id: z.number().optional(),
    initial_state: z.string().optional(),
    command_recipe: CommandRecipeSchema.optional(),
    commands: z.array(z.any()).optional(),
    risk: z.number().optional(),
    title: z.string().optional(),
    topic: z.string().optional(),
    primary_example: z.string().optional(),
    command: z.string().optional(),
  })
  .passthrough();

const CatalogFileSchema = z.array(CatalogCommandSchema);

function catalogPath() {
  const candidates = [
    path.join(process.cwd(), 'common', 'data', 'catalog', 'recipes.json'),
    path.join(process.cwd(), '..', '..', 'common', 'data', 'catalog', 'recipes.json'),
    path.join(process.cwd(), '..', 'common', 'data', 'catalog', 'recipes.json'),
    // Legacy compat (prefer recipes.json above)
    path.join(process.cwd(), 'common', 'data', 'catalog', 'commands.json'),
    path.join(process.cwd(), '..', '..', 'common', 'data', 'catalog', 'commands.json'),
    path.join(process.cwd(), '..', 'common', 'data', 'catalog', 'commands.json'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `recipes.json not found (cwd=${process.cwd()}). Tried:\n${candidates.join('\n')}`,
  );
}

function normalizeRecipe(r) {
  const steps =
    r.command_recipe?.commands ||
    r.commands ||
    (r.primary_example ? [{ command: r.primary_example, run: r.primary_example }] : []);
  const commands = steps.map((s) => ({
    command: s.command || s.run,
    run: s.command || s.run,
    comment: s.comment || '',
  }));
  const primary = commands[0]?.command || r.command || '';
  return {
    ...r,
    id: String(r.row_id ?? r.id ?? primary),
    title: r.title || primary,
    command: r.command || primary.split(/\s+/).slice(0, 2).join(' '),
    commands,
    primary_example: primary,
    topic: r.topic || 'git',
    risk: r.risk ?? 0,
  };
}

export function loadRecipes() {
  const raw = JSON.parse(readFileSync(catalogPath(), 'utf8'));
  const parsed = CatalogFileSchema.parse(raw);
  return parsed.map(normalizeRecipe);
}

export function stepCount(r) {
  if (Array.isArray(r.commands) && r.commands.length) return r.commands.length;
  return 1;
}

export function isMultiStep(r) {
  return stepCount(r) >= 2;
}

export function catalogStats(recipes = loadRecipes()) {
  const multi = recipes.filter(isMultiStep);
  return {
    total: recipes.length,
    multi: multi.length,
    single: recipes.length - multi.length,
    multiPct: recipes.length ? Math.round((100 * multi.length) / recipes.length) : 0,
  };
}

export function listTags(recipes = loadRecipes()) {
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

export const SPECIAL_TAGS = Object.freeze(['all', 'multi', 'single', 'workflow']);

export function recipesForTag(tag, recipes = loadRecipes()) {
  const t = String(tag || 'all').toLowerCase();
  if (t === 'all') return recipes;
  if (t === 'multi') return recipes.filter(isMultiStep);
  if (t === 'single') return recipes.filter((r) => !isMultiStep(r));
  if (t === 'workflow') return recipes.filter(isMultiStep);
  return recipes.filter((r) => String(r.topic || 'untagged').toLowerCase() === t);
}

function parseUsage(usage, fallback) {
  const raw = String(usage || '').trim();
  if (!raw) return { commandLine: fallback || '', blurb: '' };
  const parts = raw.split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { commandLine: parts[0], blurb: parts.slice(1).join(' ') };
  if (/^git(\s|$)/.test(parts[0])) return { commandLine: parts[0], blurb: '' };
  return { commandLine: fallback || '', blurb: parts[0] || '' };
}

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
      ? r.commands.map((c) => ({
          run: c.command || c.run,
          comment: c.comment || '',
        }))
      : [{ run: r.primary_example || r.command || '', comment: '' }],
    usage: parseUsage(r.usage, r.primary_example),
    primary: r.primary_example || '',
  }));
}
