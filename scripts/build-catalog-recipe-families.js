#!/usr/bin/env bun
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  assignRecipeFamiliesForBatch,
  assignRecipeFamiliesHeuristic,
} from '../packages/core/src/catalog/stepRecipeFamilies.js';
import { PACKAGE_ROOT } from '../packages/core/src/lib/paths.js';
import { loadEnv } from '../packages/core/src/lib/env.js';
import { llmJsonObject } from '../packages/core/src/lib/llm.js';

loadEnv();

const rawPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.raw.json');
if (!existsSync(rawPath)) {
  console.error('Missing recipes.raw.json — run build-catalog-recipes first');
  process.exit(1);
}
const recipes = JSON.parse(readFileSync(rawPath, 'utf8'));

let out;
try {
  const batchSize = 40;
  out = [];
  for (let i = 0; i < recipes.length; i += batchSize) {
    const batch = recipes.slice(i, i + batchSize);
    // eslint-disable-next-line no-await-in-loop
    const ranked = await assignRecipeFamiliesForBatch(batch, {
      llmJson: llmJsonObject,
      schedule: (fn) => fn(),
    });
    out.push(...ranked);
    console.log(`families ${Math.min(i + batchSize, recipes.length)}/${recipes.length}`);
  }
} catch (e) {
  console.warn('LLM families unavailable, using heuristic:', e.message);
  out = assignRecipeFamiliesHeuristic(recipes);
}

const file = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.familied.json');
writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${out.length} recipes → ${file}`);
