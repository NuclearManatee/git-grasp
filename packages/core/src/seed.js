import { createReadStream, existsSync, rmSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath } from './lib/paths.js';
import {
  openDb,
  insertRecipe,
  insertIntentWithEmbedding,
} from './db/schema.js';
import { getEmbedder } from './search/embed.js';
import { writeChecksumFile } from './lib/checksum.js';
import { validateRecipe, validateSearchIntent } from './lib/validator.js';

/**
 * Embed recipes.json + intents.jsonl into a fresh schema-v5 DB + checksum.
 * @param {object} [opts]
 * @param {string} [opts.recipesPath]
 * @param {string} [opts.intentsPath]
 * @param {string} [opts.dbPath]
 * @param {boolean} [opts.forceMock]
 * @returns {Promise<{ n: number, recipes: number, skipped: number, dbPath: string, hash: string, mock: boolean }>}
 */
export async function seedCatalog({
  recipesPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'recipes.json'),
  intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl'),
  dbPath = defaultDbPath(),
  forceMock = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
} = {}) {
  if (!existsSync(recipesPath)) {
    const err = new Error(`Missing recipes.json at ${recipesPath} — run build-catalog first`);
    err.code = 'SEED';
    throw err;
  }
  if (!existsSync(intentsPath)) {
    const err = new Error(`Missing intents.jsonl at ${intentsPath} — run build-catalog first`);
    err.code = 'SEED';
    throw err;
  }

  const recipes = JSON.parse(readFileSync(recipesPath, 'utf8'));
  if (!Array.isArray(recipes) || recipes.length === 0) {
    const err = new Error('recipes.json is empty');
    err.code = 'SEED';
    throw err;
  }

  const embedder = await getEmbedder({ forceMock });

  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}.sha256`, { force: true });
  } catch { /* */ }

  const db = openDb(dbPath);
  const recipeIds = new Set();
  let recipeCount = 0;
  let skipped = 0;

  for (const raw of recipes) {
    const v = validateRecipe(raw);
    if (!v.ok) {
      console.warn('skip recipe', raw.id, v.reason);
      skipped += 1;
      continue;
    }
    insertRecipe(db, raw);
    recipeIds.add(raw.id);
    recipeCount += 1;
  }

  const rl = createInterface({ input: createReadStream(intentsPath), crlfDelay: Infinity });
  let n = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const raw = JSON.parse(line);
      const intent = {
        id: raw.id,
        recipe_id: raw.recipe_id,
        intent_text: raw.intent_text || raw.intent_description,
        skill_level: Number(raw.skill_level) === 5 ? 4 : Number(raw.skill_level),
      };
      const v = validateSearchIntent(intent, { recipeIds });
      if (!v.ok) {
        console.warn('skip intent', intent.id, v.reason);
        skipped += 1;
        continue;
      }
      const embedding = await embedder.embed(intent.intent_text);
      insertIntentWithEmbedding(db, { ...intent, embedding });
      n += 1;
      if (n % 100 === 0) console.log(`seeded ${n} intents…`);
    }
  } finally {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch { /* */ }
    db.close();
  }

  const hash = writeChecksumFile(dbPath);
  return {
    n,
    recipes: recipeCount,
    skipped,
    dbPath,
    hash,
    mock: Boolean(embedder.mock),
  };
}
