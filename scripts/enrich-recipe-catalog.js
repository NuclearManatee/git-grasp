#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  enrichRecipesFromGolden,
  enrichRecipesFromEssentials,
  enrichIntentsFromGolden,
} from '../packages/core/src/catalog/enrichRecipes.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';

const famPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.familied.json');
const rawPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.raw.json');
const inputPath = existsSync(famPath) ? famPath : rawPath;
let recipes = JSON.parse(readFileSync(inputPath, 'utf8'));

const intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.raw.jsonl');
let intents = existsSync(intentsPath)
  ? readFileSync(intentsPath, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

let golden = [];
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
if (existsSync(goldenPath)) {
  golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
}

recipes = enrichRecipesFromEssentials(recipes, glossary);
recipes = enrichRecipesFromGolden(recipes, golden, glossary);
intents = enrichIntentsFromGolden(intents, recipes, golden);

writeFileSync(
  path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.enriched.json'),
  `${JSON.stringify(recipes, null, 2)}\n`,
);
writeFileSync(
  path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.enriched.jsonl'),
  `${intents.map((i) => JSON.stringify(i)).join('\n')}\n`,
);
console.log(`Enriched ${recipes.length} recipes, ${intents.length} intents`);
