// @ts-nocheck
/**
 * Offline corpus dedupe: rewrite literals → placeholders, merge structural twins,
 * write next recipes.vN.json (does not run LLM ground).
 *
 *   bun apps/pipeline/src/corpus-dedupe.ts
 *   bun apps/pipeline/src/corpus-dedupe.ts --seed
 */
import { loadEnv } from '../../../../common/src/lib/env.ts';
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { catalogDir } from '../../../../common/src/lib/paths.ts';
import { mergeRecipesByStructuralFingerprint } from '../../../../common/src/build/mergeRecipes.ts';
import {
  nextCorpusVersion,
  corpusVersionsDir,
  latestCorpusMetaPath,
} from '../../../../common/src/build/corpusVersion.ts';

loadEnv();

const args = process.argv.slice(2);
const doSeed = args.includes('--seed');

const recipesPath = path.join(catalogDir(), 'recipes.json');
const v4Path = path.join(catalogDir(), 'versions', 'recipes.v4.json');

let sourcePath = recipesPath;
if (!existsSync(sourcePath) && existsSync(v4Path)) sourcePath = v4Path;
if (!existsSync(sourcePath)) {
  console.error('No recipes.json / recipes.v4.json found');
  process.exit(1);
}

// Preserve v4 explicitly if present
if (existsSync(v4Path)) {
  console.log(`[dedupe] preserved archive: ${v4Path}`);
} else if (existsSync(recipesPath)) {
  const archive = path.join(catalogDir(), 'versions', 'recipes.v4.pre-dedupe.json');
  mkdirSync(path.dirname(archive), { recursive: true });
  if (!existsSync(archive)) {
    copyFileSync(recipesPath, archive);
    console.log(`[dedupe] archived current recipes → ${archive}`);
  }
}

const raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
const input = Array.isArray(raw)
  ? raw
  : Array.isArray(raw?.recipes)
    ? raw.recipes
    : [];

const merged = mergeRecipesByStructuralFingerprint(input, { scope: 'leaf' });
console.log(
  `[dedupe] ${merged.before} → ${merged.after} (removed ${merged.removed} structural twins)`,
);

const version = nextCorpusVersion();
const dir = corpusVersionsDir();
mkdirSync(dir, { recursive: true });
const doc = {
  version,
  created_at: new Date().toISOString(),
  recipe_count: merged.recipes.length,
  recipes: merged.recipes,
  dedupe: {
    from: sourcePath,
    before: merged.before,
    after: merged.after,
    removed: merged.removed,
    scope: 'leaf',
  },
};
const versionPath = path.join(dir, `recipes.v${version}.json`);
writeFileSync(versionPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
writeFileSync(
  path.join(catalogDir(), 'recipes.json'),
  `${JSON.stringify(merged.recipes, null, 2)}\n`,
  'utf8',
);
writeFileSync(
  path.join(catalogDir(), 'commands.json'),
  `${JSON.stringify(merged.recipes, null, 2)}\n`,
  'utf8',
);
writeFileSync(
  latestCorpusMetaPath(),
  `${JSON.stringify(
    {
      version,
      path: versionPath,
      recipe_count: merged.recipes.length,
      created_at: doc.created_at,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
console.log(`[dedupe] wrote ${versionPath}`);

if (doSeed) {
  const { seedCatalog } = await import('../../../../common/src/seed.ts');
  await seedCatalog({});
  console.log('[dedupe] seed complete');
}
