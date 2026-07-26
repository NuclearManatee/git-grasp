#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  generateIntentsForRecipeWithAreYouSure,
  heuristicIntentsForRecipe,
} from '../packages/core/src/catalog/stepRecipeIntents.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { loadEnv, requireLlmKey } from '../packages/core/src/lib/env.js';
import { llmJsonObject } from '../packages/core/src/lib/llm.js';
import { getEmbedder } from '../packages/core/src/search/embed.js';
import { DEFAULT_GLOSSARY } from '../packages/core/src/catalog/step0Glossary.js';
import { createRateLimiter } from '../packages/core/src/lib/rateLimit.js';

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
const maxRecipes = Number(process.env.GIT_HELP_MAX_INTENT_RECIPES || 0) || recipes.length;
const aysRounds = Number(process.env.GIT_HELP_INTENT_AYS_ROUNDS || 3);
const slice = recipes.slice(0, maxRecipes);
let all = [];

if (useHeuristic) {
  for (const r of slice) all.push(...heuristicIntentsForRecipe(r));
} else {
  requireLlmKey();
  mkdirSync(path.join(PACKAGE_ROOT, 'local', 'catalog'), { recursive: true });
  const lim = createRateLimiter({
    statePath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'llm-day.json'),
    checkpointPath: path.join(PACKAGE_ROOT, 'local', 'catalog', 'intent-checkpoint.json'),
  });
  const embedder = await getEmbedder({
    forceMock: process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
  });
  const embedFn = (t) => embedder.embed(t);
  const start = lim.getCursor();
  for (let i = start; i < slice.length; i += 1) {
    const r = slice[i];
    // eslint-disable-next-line no-await-in-loop
    const { intents, rounds } = await generateIntentsForRecipeWithAreYouSure(r, {
      llmJson: llmJsonObject,
      schedule: (fn, opts) => lim.schedule(fn, opts),
      glossary,
      embedFn,
      maxRounds: aysRounds,
    });
    all.push(...intents);
    lim.setCursor(i + 1);
    if ((i + 1) % 5 === 0 || i === slice.length - 1) {
      const aysAdds = rounds.reduce((s, x) => s + (x.added || 0), 0);
      console.log(`intents ${i + 1}/${slice.length} (recipe=${r.id}, n=${intents.length}, ays+${aysAdds})`);
    }
  }
}

const file = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.raw.jsonl');
writeFileSync(file, `${all.map((x) => JSON.stringify(x)).join('\n')}\n`);
console.log(`Wrote ${all.length} intents → ${file}`);
