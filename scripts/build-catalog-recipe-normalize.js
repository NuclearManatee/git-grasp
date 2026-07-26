#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  normalizeRecipes,
  normalizeIntents,
  writeRecipesCatalog,
  writeIntentsCatalog,
} from '../packages/core/src/catalog/stepRecipeNormalize.js';
import { loadManOracle, makeFlagValidator } from '../packages/core/src/catalog/sources/manOracle.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';

const enrichedR = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.enriched.json');
const famR = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.familied.json');
const rawR = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.raw.json');
const recipePath = [enrichedR, famR, rawR].find((p) => existsSync(p));
if (!recipePath) {
  console.error('No recipes to normalize');
  process.exit(1);
}

const enrichedI = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.enriched.jsonl');
const rawI = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.raw.jsonl');
const intentPath = [enrichedI, rawI].find((p) => existsSync(p));

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const oracle = loadManOracle(PACKAGE_ROOT);
const validateFlags = oracle ? makeFlagValidator(oracle) : null;

const { recipes, drops: recipeDrops } = normalizeRecipes(
  JSON.parse(readFileSync(recipePath, 'utf8')),
  { glossary, validateFlags },
);

const rawIntents = intentPath
  ? readFileSync(intentPath, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];
const { intents, drops: intentDrops } = normalizeIntents(rawIntents, recipes);

writeRecipesCatalog(recipes, PACKAGE_ROOT);
writeIntentsCatalog(intents, PACKAGE_ROOT);

writeFileSync(
  path.join(PACKAGE_ROOT, 'data', 'catalog', 'drops.recipes.jsonl'),
  `${[...recipeDrops, ...intentDrops].map((d) => JSON.stringify(d)).join('\n')}\n`,
);

console.log(`Normalized ${recipes.length} recipes, ${intents.length} intents`);
console.log(`Drops: recipes=${recipeDrops.length} intents=${intentDrops.length}`);
