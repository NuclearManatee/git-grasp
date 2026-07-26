import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  validateRecipe,
  validateSearchIntent,
  normalizeExample,
  recipeSlugFromTitle,
} from '../lib/validator.js';
import { sanitizeField } from '../lib/ansi.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { normalizeUsage } from '../db/utils.js';
import { deriveCommandKey } from './stepRecipes.js';
import { PACKAGE_ROOT } from '../lib/paths.js';

/**
 * Normalize recipes: materialize placeholders, validate, dedupe by primary_example.
 */
export function normalizeRecipes(rawRecipes, {
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
} = {}) {
  const drops = [];
  const byExample = new Map();
  const byId = new Map();

  for (const raw of rawRecipes || []) {
    const commands = (Array.isArray(raw.commands) ? raw.commands : []).map((c) => ({
      run: normalizeExample(materializePlaceholders(String(c.run || ''), glossary)),
      comment: sanitizeField(c.comment || '', 200),
    })).filter((c) => c.run);

    if (!commands.length) {
      drops.push({ id: raw.id, reason: 'commands_empty' });
      continue;
    }

    const primary = normalizeExample(raw.primary_example || commands[0].run);
    const title = sanitizeField(raw.title || primary, 160);
    let id = sanitizeField(raw.id || recipeSlugFromTitle(title), 96);
    const recipe = {
      id,
      title,
      commands,
      explanation: sanitizeField(raw.explanation || '', 4000),
      intent_family: sanitizeField(raw.intent_family || '', 128),
      simplicity_rank: Math.max(1, Number(raw.simplicity_rank) || 1),
      usage: normalizeUsage(raw.usage, primary),
      topic: sanitizeField(raw.topic || 'advanced', 64),
      primary_example: primary,
      command: normalizeExample(raw.command || deriveCommandKey(primary)),
      source: sanitizeField(raw.source || '', 64),
    };

    const v = validateRecipe(recipe, { validateFlags: validateFlags || undefined });
    if (!v.ok) {
      drops.push({ id: recipe.id, reason: v.reason, run: v.run });
      continue;
    }

    // Prefer cheat-sheet over tldr/progit on same primary_example
    const prev = byExample.get(primary);
    if (prev) {
      const rank = { 'cheat-sheet': 0, tldr: 1, universe: 1, progit: 2 };
      const prevR = rank[prev.source] ?? 3;
      const nextR = rank[recipe.source] ?? 3;
      if (nextR >= prevR) {
        drops.push({ id: recipe.id, reason: 'dup_example', primary });
        continue;
      }
    }
    if (byId.has(recipe.id) && byId.get(recipe.id).primary_example !== primary) {
      recipe.id = `${recipe.id}-${byId.size}`;
    }
    byExample.set(primary, recipe);
    byId.set(recipe.id, recipe);
  }

  const recipes = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { recipes, drops };
}

/**
 * Normalize intents against recipe id set.
 */
export function normalizeIntents(rawIntents, recipes) {
  const recipeIds = new Set(recipes.map((r) => r.id));
  const drops = [];
  const kept = [];
  const seen = new Set();
  for (const raw of rawIntents || []) {
    const intent = {
      id: String(raw.id || ''),
      recipe_id: String(raw.recipe_id || ''),
      intent_text: sanitizeField(raw.intent_text || raw.intent_description || '', 2000),
      skill_level: Number(raw.skill_level),
    };
    const v = validateSearchIntent(intent, { recipeIds });
    if (!v.ok) {
      drops.push({ id: intent.id, reason: v.reason });
      continue;
    }
    const key = `${intent.recipe_id}|${intent.skill_level}|${intent.intent_text.toLowerCase()}`;
    if (seen.has(key)) {
      drops.push({ id: intent.id, reason: 'dup' });
      continue;
    }
    seen.add(key);
    kept.push(intent);
  }
  return { intents: kept, drops };
}

export function writeRecipesCatalog(recipes, root = PACKAGE_ROOT) {
  const dir = path.join(root, 'data', 'catalog');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'recipes.json');
  writeFileSync(file, `${JSON.stringify(recipes, null, 2)}\n`);
  return file;
}

export function writeIntentsCatalog(intents, root = PACKAGE_ROOT) {
  const dir = path.join(root, 'data', 'catalog');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'intents.jsonl');
  const body = intents.map((i) => JSON.stringify(i)).join('\n') + (intents.length ? '\n' : '');
  writeFileSync(file, body);
  return file;
}

export function loadRecipesCatalog(root = PACKAGE_ROOT) {
  const file = path.join(root, 'data', 'catalog', 'recipes.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function loadIntentsCatalog(root = PACKAGE_ROOT) {
  const file = path.join(root, 'data', 'catalog', 'intents.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
