// @ts-nocheck
/**
 * Seed product DB from versioned recipes.json (description embeddings).
 */
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultDbPath, catalogDir } from './lib/paths.js';
import {
  openDb,
  insertRecipe,
  listRecipes,
  countRecipes,
  finalizeSearchIndex,
  recipeEmbedText,
  setMetaValue,
} from './db/schema.js';
import { getEmbedder } from './search/embed.js';
import { writeChecksumFile } from './lib/checksum.js';
import { ProductRecipeSchema } from './schemas/recipe.js';
import { readLatestCorpusMeta } from './build/corpusVersion.js';

/**
 * Write catalog JSON export from an open v9 DB.
 */
export function exportCatalogFromDb(db, {
  recipesPath = path.join(catalogDir(), 'recipes.json'),
} = {}) {
  mkdirSync(path.dirname(recipesPath), { recursive: true });
  const recipes = listRecipes(db);
  writeFileSync(recipesPath, `${JSON.stringify(recipes, null, 2)}\n`);
  // Compat stubs for older tooling
  writeFileSync(
    path.join(catalogDir(), 'commands.json'),
    `${JSON.stringify(recipes, null, 2)}\n`,
  );
  writeFileSync(path.join(catalogDir(), 'intents.jsonl'), '');
  return { recipes: recipes.length, recipesPath };
}

/**
 * Embed recipes.json into a fresh schema-v9 DB + checksum.
 */
export async function seedCatalog({
  recipesPath = path.join(catalogDir(), 'recipes.json'),
  commandsPath = path.join(catalogDir(), 'commands.json'),
  dbPath = defaultDbPath(),
  forceMock = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
} = {}) {
  let sourcePath = recipesPath;
  if (!existsSync(sourcePath) && existsSync(commandsPath)) {
    sourcePath = commandsPath;
  }
  if (!existsSync(sourcePath)) {
    const err = new Error(
      `Missing recipes.json at ${recipesPath} — run build:loop first`,
    );
    err.code = 'SEED';
    throw err;
  }

  const raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const recipes = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.recipes)
      ? raw.recipes
      : [];
  if (!recipes.length) {
    const err = new Error('recipes.json is empty');
    err.code = 'SEED';
    throw err;
  }

  if (existsSync(dbPath)) {
    rmSync(dbPath);
  }
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  const embedder = await getEmbedder({ forceMock });

  try {
    for (const row of recipes) {
      // Accept v9 product shape or lightly adapt legacy command rows
      let recipe = row;
      if (!row.description && row.command_recipe) {
        recipe = {
          id: String(row.id || row.row_id || `r-${row.row_id}`),
          commands: row.command_recipe?.commands || row.commands,
          title: row.title || 'untitled',
          description: row.title || 'untitled',
          tags: row.tags || [],
          taxonomy_leaf: row.taxonomy_leaf || 'legacy',
          paraphrases: [],
          provenance: row.provenance || 'synthetic',
          validated: true,
          initial_state: row.initial_state || '',
          initial_state_physical_hash: row.initial_state_physical_hash || '',
          final_state_physical_hash: row.final_state_physical_hash || '',
          risk: row.risk ?? 0,
        };
      }
      const parsed = ProductRecipeSchema.safeParse({
        ...recipe,
        validated: recipe.validated ?? true,
        paraphrases: recipe.paraphrases || [],
        tags: recipe.tags || [],
        provenance: recipe.provenance || 'synthetic',
      });
      if (!parsed.success) {
        throw new Error(
          `Invalid recipe ${recipe.id}: ${parsed.error.issues[0]?.message}`,
        );
      }
      const emb = await embedder.embed(recipeEmbedText(parsed.data));
      insertRecipe(db, parsed.data, emb);
    }
    finalizeSearchIndex(db);
    const latest = readLatestCorpusMeta();
    if (latest?.version != null) {
      setMetaValue(db, 'corpus_version', latest.version);
      if (latest.recipe_count != null) {
        setMetaValue(db, 'corpus_recipe_count', latest.recipe_count);
      }
      if (latest.created_at) {
        setMetaValue(db, 'corpus_created_at', latest.created_at);
      }
    }
  } finally {
    db.close();
  }

  const hash = writeChecksumFile(dbPath);
  const verify = openDb(dbPath, { readonly: true });
  let n = 0;
  try {
    n = countRecipes(verify);
  } finally {
    verify.close();
  }
  return {
    dbPath,
    recipes: n,
    n: 0,
    skipped: 0,
    hash,
    mock: Boolean(forceMock),
  };
}

export async function main() {
  const result = await seedCatalog();
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
