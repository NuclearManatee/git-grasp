#!/usr/bin/env node
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath } from '../src/lib/paths.js';
import { openDb, insertCommandRow } from '../src/db/schema.js';
import { getEmbedder } from '../src/search/embed.js';
import { writeChecksumFile } from '../src/lib/checksum.js';
import { validateIntentRow } from '../src/lib/validator.js';
import { rmSync } from 'node:fs';

const intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl');
const dbPath = defaultDbPath();

if (!existsSync(intentsPath)) {
  console.error('Missing intents.jsonl — run npm run build-catalog first');
  process.exit(1);
}

const forceMock = process.env.GIT_HELP_MOCK_EMBEDDINGS === '1' || process.argv.includes('--mock');
const embedder = await getEmbedder({ forceMock });

try {
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}.sha256`, { force: true });
} catch { /* */ }

const client = await openDb(dbPath);
const rl = createInterface({ input: createReadStream(intentsPath), crlfDelay: Infinity });

let n = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  const row = JSON.parse(line);
  const v = validateIntentRow(row);
  if (!v.ok) {
    console.warn('skip', row.id, v.reason);
    continue;
  }
  const embedding = await embedder.embed(row.intent_description);
  await insertCommandRow(client, { ...row, embedding });
  n += 1;
  if (n % 100 === 0) console.log(`seeded ${n}…`);
}
client.close?.();
const hash = writeChecksumFile(dbPath);
console.log(`Seeded ${n} rows → ${dbPath}`);
console.log(`sha256 ${hash}`);
console.log(`embeddings: ${embedder.mock ? 'mock' : 'all-MiniLM-L6-v2'}`);
