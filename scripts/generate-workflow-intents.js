#!/usr/bin/env bun
/**
 * Generate LLM intents only for recipes missing coverage (default: source=workflow).
 * Appends to intents.raw.jsonl then relies on enrich+normalize, OR merges into intents.jsonl.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { generateIntentsForRecipeWithAreYouSure } from '../packages/core/src/catalog/stepRecipeIntents.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../packages/core/src/lib/env.js';
import { llmJsonObject } from '../packages/core/src/lib/llm.js';
import { getEmbedder } from '../packages/core/src/search/embed.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';
import { createRateLimiter } from '../packages/core/src/lib/rateLimit.js';
import {
  enrichIntentsFromGolden,
  enrichRecipesFromWorkflows,
} from '../packages/core/src/catalog/enrichRecipes.js';
import { normalizeRecipes, normalizeIntents, writeRecipesCatalog, writeIntentsCatalog } from '../packages/core/src/catalog/stepRecipeNormalize.js';

loadEnv();
requireLlmKey();

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const recipesPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.json');
let recipes = JSON.parse(readFileSync(recipesPath, 'utf8'));
recipes = enrichRecipesFromWorkflows(recipes, null, glossary);
const { recipes: normRecipes } = normalizeRecipes(recipes, { glossary });

const intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl');
let intents = existsSync(intentsPath)
  ? readFileSync(intentsPath, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];

const have = new Set(intents.map((i) => i.recipe_id));
const need = normRecipes.filter((r) => r.source === 'workflow' && !have.has(r.id));
console.log(`Recipes=${normRecipes.length}; workflow needing intents=${need.length}`);

mkdirSync(path.join(PACKAGE_ROOT, 'local', 'catalog'), { recursive: true });
const lim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  checkpointPath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'workflow-intent-checkpoint.json'),
});
const embedder = await getEmbedder({
  forceMock: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
});
const embedFn = (t) => embedder.embed(t);
const aysRounds = Number(process.env.GIT_HELP_INTENT_AYS_ROUNDS || 2);

const start = lim.getCursor();
for (let i = start; i < need.length; i += 1) {
  const r = need[i];
  const { intents: neu, rounds } = await generateIntentsForRecipeWithAreYouSure(r, {
    llmJson: llmJsonObject,
    schedule: (fn, opts) => lim.schedule(fn, opts),
    glossary,
    embedFn,
    maxRounds: aysRounds,
  });
  intents.push(...neu);
  lim.setCursor(i + 1);
  const aysAdds = rounds.reduce((s, x) => s + (x.added || 0), 0);
  console.log(`workflow intents ${i + 1}/${need.length} id=${r.id} n=${neu.length} ays+${aysAdds}`);
}

let golden = [];
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
if (existsSync(goldenPath)) {
  golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
}
intents = enrichIntentsFromGolden(intents, normRecipes, golden);

const { intents: normIntents } = normalizeIntents(intents, normRecipes);
writeRecipesCatalog(normRecipes);
writeIntentsCatalog(normIntents);
writeFileSync(
  path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.raw.json'),
  `${JSON.stringify(normRecipes, null, 2)}\n`,
);
console.log(`Wrote ${normRecipes.length} recipes, ${normIntents.length} intents`);
