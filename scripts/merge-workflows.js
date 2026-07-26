#!/usr/bin/env bun
/**
 * Merge curated workflows.json into recipes.json and write recipes.raw.json.
 * Does not call LLM. Use before recipe-intents for new workflow ids.
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { enrichRecipesFromWorkflows } from '../packages/core/src/catalog/enrichRecipes.js';
import { workflowCoverageReport } from '../packages/core/src/catalog/stepRecipeWorkflows.js';
import { normalizeRecipes, writeRecipesCatalog } from '../packages/core/src/catalog/stepRecipeNormalize.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const recipesPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.json');
let recipes = existsSync(recipesPath) ? JSON.parse(readFileSync(recipesPath, 'utf8')) : [];
const before = recipes.length;
recipes = enrichRecipesFromWorkflows(recipes, null, glossary);
const { recipes: normalized, drops } = normalizeRecipes(recipes, { glossary });
const dir = path.join(PACKAGE_ROOT, 'data', 'catalog');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'recipes.raw.json'), `${JSON.stringify(normalized, null, 2)}\n`);
writeRecipesCatalog(normalized);
const report = workflowCoverageReport(normalized);
console.log(`Merged workflows: ${before} → ${normalized.length} (drops=${drops.length})`);
console.log(report);
