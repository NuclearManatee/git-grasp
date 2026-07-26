#!/usr/bin/env bun
/** Write small fixture recipes/intents for tests (no network/LLM). */
import { fixtureRecipes } from '../packages/core/src/catalog/stepRecipes.js';
import { heuristicIntentsForRecipe } from '../packages/core/src/catalog/stepRecipeIntents.js';
import { assignRecipeFamiliesHeuristic } from '../packages/core/src/catalog/stepRecipeFamilies.js';
import {
  normalizeRecipes,
  normalizeIntents,
} from '../packages/core/src/catalog/stepRecipeNormalize.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const recipes = assignRecipeFamiliesHeuristic(fixtureRecipes());
const { recipes: normR } = normalizeRecipes(recipes);
let intents = [];
for (const r of normR) intents.push(...heuristicIntentsForRecipe(r));
const { intents: normI } = normalizeIntents(intents, normR);

const fixtureDir = path.join(PACKAGE_ROOT, 'test', 'fixtures', 'catalog');
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(path.join(fixtureDir, 'recipes.json'), `${JSON.stringify(normR, null, 2)}\n`);
writeFileSync(
  path.join(fixtureDir, 'intents.jsonl'),
  `${normI.map((i) => JSON.stringify(i)).join('\n')}\n`,
);

if (process.argv.includes('--install-data')) {
  const dir = path.join(PACKAGE_ROOT, 'data', 'catalog');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'recipes.json'), `${JSON.stringify(normR, null, 2)}\n`);
  writeFileSync(
    path.join(dir, 'intents.jsonl'),
    `${normI.map((i) => JSON.stringify(i)).join('\n')}\n`,
  );
  console.log(`Also wrote data/catalog (${normR.length} recipes)`);
}

console.log(`Fixtures: ${normR.length} recipes, ${normI.length} intents → ${fixtureDir}`);
