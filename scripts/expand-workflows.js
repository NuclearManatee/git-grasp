#!/usr/bin/env bun
/**
 * Expand multi-step workflows via LLM into recipes.json, then intent-gen for newcomers.
 *   bun scripts/expand-workflows.js
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../packages/core/src/lib/env.js';
import { llmJsonObject } from '../packages/core/src/lib/llm.js';
import { createRateLimiter } from '../packages/core/src/lib/rateLimit.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';
import {
  expandWorkflowsWithLlm,
  workflowCoverageReport,
} from '../packages/core/src/catalog/stepRecipeWorkflows.js';
import { generateIntentsForRecipeWithAreYouSure } from '../packages/core/src/catalog/stepRecipeIntents.js';
import { getEmbedder } from '../packages/core/src/search/embed.js';
import {
  normalizeRecipes,
  normalizeIntents,
  writeRecipesCatalog,
  writeIntentsCatalog,
} from '../packages/core/src/catalog/stepRecipeNormalize.js';
import { enrichIntentsFromGolden } from '../packages/core/src/catalog/enrichRecipes.js';

loadEnv();
requireLlmKey();

const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const recipesPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.json');
let recipes = JSON.parse(readFileSync(recipesPath, 'utf8'));
const before = workflowCoverageReport(recipes);
console.log('Before:', before);

const minMulti = Number(process.env.GIT_HELP_MIN_MULTI || 120);
const maxRounds = Number(process.env.GIT_HELP_WORKFLOW_ROUNDS || 6);

mkdirSync(path.join(PACKAGE_ROOT, 'local', 'catalog'), { recursive: true });
const lim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
});

const expanded = await expandWorkflowsWithLlm(recipes, {
  llmJson: llmJsonObject,
  schedule: (fn, opts) => lim.schedule(fn, opts),
  glossary,
  maxRounds,
  minMulti,
  judge: true,
  onRound: (r) => console.log(
    `  Workflow round ${r.round}: +${r.added}/${r.proposed} multi=${r.multiCount} missing=${(r.missing || []).join(',') || 'none'}`,
  ),
});
recipes = expanded.recipes;
const { recipes: normRecipes } = normalizeRecipes(recipes, { glossary });
console.log('After expand:', workflowCoverageReport(normRecipes));

const intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl');
let intents = existsSync(intentsPath)
  ? readFileSync(intentsPath, 'utf8').split(/\n/).filter(Boolean).map((l) => JSON.parse(l))
  : [];
const have = new Set(intents.map((i) => i.recipe_id));
const need = normRecipes.filter((r) => (r.commands?.length || 0) >= 2 && !have.has(r.id));
console.log(`Multi-step recipes needing intents: ${need.length}`);

const embedder = await getEmbedder({
  forceMock: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
});
const embedFn = (t) => embedder.embed(t);
const aysRounds = Number(process.env.GIT_HELP_INTENT_AYS_ROUNDS || 2);
const intentLim = createRateLimiter({
  statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
  checkpointPath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'expand-intent-checkpoint.json'),
});

for (let i = 0; i < need.length; i += 1) {
  const r = need[i];
  const { intents: neu, rounds } = await generateIntentsForRecipeWithAreYouSure(r, {
    llmJson: llmJsonObject,
    schedule: (fn, opts) => intentLim.schedule(fn, opts),
    glossary,
    embedFn,
    maxRounds: aysRounds,
  });
  intents.push(...neu);
  const aysAdds = rounds.reduce((s, x) => s + (x.added || 0), 0);
  console.log(`intents ${i + 1}/${need.length} id=${r.id} n=${neu.length} ays+${aysAdds}`);
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
