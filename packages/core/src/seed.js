import { createReadStream, existsSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath } from './lib/paths.js';
import { openDb, insertCommandRow } from './db/schema.js';
import { getEmbedder } from './search/embed.js';
import { writeChecksumFile } from './lib/checksum.js';
import { validateIntentRow } from './lib/validator.js';

/**
 * Embed intents.jsonl into a fresh schema-v4 DB + checksum.
 * @param {object} [opts]
 * @param {string} [opts.intentsPath]
 * @param {string} [opts.dbPath]
 * @param {boolean} [opts.forceMock]
 * @returns {Promise<{ n: number, skipped: number, dbPath: string, hash: string, mock: boolean }>}
 */
export async function seedCatalog({
  intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl'),
  dbPath = defaultDbPath(),
  forceMock = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1',
} = {}) {
  if (!existsSync(intentsPath)) {
    const err = new Error(`Missing intents.jsonl at ${intentsPath} — run build-catalog first`);
    err.code = 'SEED';
    throw err;
  }

  const embedder = await getEmbedder({ forceMock });

  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}.sha256`, { force: true });
  } catch { /* */ }

  const db = openDb(dbPath);
  const rl = createInterface({ input: createReadStream(intentsPath), crlfDelay: Infinity });

  let n = 0;
  let skipped = 0;
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const raw = JSON.parse(line);
      const row = {
        ...raw,
        example: raw.example || raw.examples || raw.command,
        usage: raw.usage || raw.example || raw.examples || raw.command,
        intent_family: raw.intent_family || '',
        simplicity_rank: Number(raw.simplicity_rank) || 1,
        skill_level: Number(raw.skill_level) === 5 ? 4 : Number(raw.skill_level),
      };
      const v = validateIntentRow(row);
      if (!v.ok) {
        console.warn('skip', row.id, v.reason);
        skipped += 1;
        continue;
      }
      const embedding = await embedder.embed(row.intent_description);
      insertCommandRow(db, { ...row, embedding });
      n += 1;
      if (n % 100 === 0) console.log(`seeded ${n}…`);
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
    skipped,
    dbPath,
    hash,
    mock: Boolean(embedder.mock),
  };
}
