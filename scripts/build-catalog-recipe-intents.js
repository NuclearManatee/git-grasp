#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  generateIntentsForRecipe,
  heuristicIntentsForRecipe,
} from '../packages/core/src/catalog/stepRecipeIntents.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { loadEnv } from '../packages/core/src/lib/env.js';
import { llmJsonObject } from '../packages/core/src/lib/llm.js';
import { getEmbedder } from '../packages/core/src/search/embed.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';

loadEnv();

const famPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.familied.json');
const rawPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.raw.json');
const inputPath = existsSync(famPath) ? famPath : rawPath;
if (!existsSync(inputPath)) {
  console.error('Missing recipes — run build-catalog-recipes first');
  process.exit(1);
}
const recipes = JSON.parse(readFileSync(inputPath, 'utf8'));
const glossaryPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'glossary.json');
const glossary = existsSync(glossaryPath)
  ? JSON.parse(readFileSync(glossaryPath, 'utf8'))
  : DEFAULT_GLOSSARY;

const useHeuristic = process.argv.includes('--heuristic');
let all = [];

if (useHeuristic) {
  for (const r of recipes) all.push(...heuristicIntentsForRecipe(r));
} else {
  try {
    const embedder = await getEmbedder({
      forceMock: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
    });
    const embedFn = (t) => embedder.embed(t);
    for (let i = 0; i < recipes.length; i += 1) {
      const r = recipes[i];
      // eslint-disable-next-line no-await-in-loop
      const rows = await generateIntentsForRecipe(r, {
        llmJson: llmJsonObject,
        glossary,
        embedFn,
      });
      all.push(...rows);
      if ((i + 1) % 10 === 0) console.log(`intents ${i + 1}/${recipes.length}`);
    }
  } catch (e) {
    console.warn('LLM intents unavailable, using heuristic:', e.message);
    all = [];
    for (const r of recipes) all.push(...heuristicIntentsForRecipe(r));
  }
}

const file = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.raw.jsonl');
writeFileSync(file, `${all.map((x) => JSON.stringify(x)).join('\n')}\n`);
console.log(`Wrote ${all.length} intents → ${file}`);
