#!/usr/bin/env bun
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { synthesizeRecipes } from '../packages/core/src/catalog/stepRecipes.js';
import { expandRecipesWithAreYouSure } from '../packages/core/src/catalog/stepRecipeAys.js';
import {
  enrichRecipesFromEssentials,
  enrichRecipesFromGolden,
  enrichRecipesFromWorkflows,
} from '../packages/core/src/catalog/enrichRecipes.js';
import {
  expandWorkflowsWithLlm,
  workflowCoverageReport,
} from '../packages/core/src/catalog/stepRecipeWorkflows.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';
import { loadManOracle, makeFlagValidator } from '../packages/core/src/catalog/sources/manOracle.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../packages/core/src/lib/env.js';
import { llmJsonObject } from '../packages/core/src/lib/llm.js';
import { createRateLimiter } from '../packages/core/src/lib/rateLimit.js';

loadEnv();

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const skipAys = process.argv.includes('--no-ays');
const skipWorkflowExpand = process.argv.includes('--no-workflow-expand');
const minRecipes = Number(process.env.GIT_HELP_MIN_RECIPES || 300);
const maxRounds = Number(process.env.GIT_HELP_AYS_ROUNDS || 5);
const minMulti = Number(process.env.GIT_HELP_MIN_MULTI || 80);
const workflowRounds = Number(process.env.GIT_HELP_WORKFLOW_ROUNDS || 4);

let recipes = synthesizeRecipes({ root: PACKAGE_ROOT, glossary });
console.log(`Base recipes from sources: ${recipes.length}`);

recipes = enrichRecipesFromEssentials(recipes, glossary);
let golden = [];
const goldenPath = path.join(PACKAGE_ROOT, 'eval', 'golden', 'cases.json');
if (existsSync(goldenPath)) {
  golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
}
recipes = enrichRecipesFromGolden(recipes, golden, glossary);
recipes = enrichRecipesFromWorkflows(recipes, null, glossary);
console.log(`After essentials+golden+workflows: ${recipes.length}`);
console.log('  workflow coverage:', workflowCoverageReport(recipes));

if (!skipAys) {
  requireLlmKey();
  const lim = createRateLimiter({
    statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  });
  const oracle = loadManOracle(PACKAGE_ROOT);
  const validateFlags = oracle ? makeFlagValidator(oracle) : null;
  const expanded = await expandRecipesWithAreYouSure(recipes, {
    llmJson: llmJsonObject,
    schedule: (fn, opts) => lim.schedule(fn, opts),
    glossary,
    validateFlags,
    maxRounds,
    minRecipes,
    onRound: (r) => console.log(
      `  AYS round ${r.round}: +${r.added}/${r.proposed} → ${r.count} (sure=${r.sure})`,
    ),
  });
  recipes = expanded.recipes;
  console.log(`After AYS: ${recipes.length} recipes (sure=${expanded.sure}, rounds=${expanded.rounds.length})`);
}

if (!skipWorkflowExpand) {
  requireLlmKey();
  const lim = createRateLimiter({
    statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  });
  const wf = await expandWorkflowsWithLlm(recipes, {
    llmJson: llmJsonObject,
    schedule: (fn, opts) => lim.schedule(fn, opts),
    glossary,
    maxRounds: workflowRounds,
    minMulti,
    judge: true,
    onRound: (r) => console.log(
      `  Workflow round ${r.round}: +${r.added}/${r.proposed} multi=${r.multiCount} missing=${(r.missing || []).join(',') || 'none'}`,
    ),
  });
  recipes = wf.recipes;
  console.log(`After workflow expand: ${recipes.length}`, workflowCoverageReport(recipes));
}

const dir = path.join(PACKAGE_ROOT, 'data', 'catalog');
mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'recipes.raw.json');
writeFileSync(file, `${JSON.stringify(recipes, null, 2)}\n`);
console.log(`Wrote ${recipes.length} recipes → ${file}`);
