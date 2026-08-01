/**
 * Display-path smoke for pin NL bank against staging (or product) DB.
 * Usage: bun scripts/smoke-pin-display.ts [dbPath]
 */
import { loadEnv } from '../packages/core/src/lib/env.ts';
import { existsSync } from 'node:fs';
import {
  openDb,
  finalizeSearchIndex,
  knnRecall,
  ftsRecall,
  loadGitVerbs,
  getCommand,
} from '../packages/core/src/db/schema.ts';
import { parseCommands, primaryCommand, renderSnippet } from '../packages/core/src/db/recipeFormat.ts';
import { buildStagingDbPath, defaultDbPath } from '../packages/core/src/lib/paths.ts';
import { loadBank, evalDataDir } from '../packages/core/src/build/evalGate.ts';
import { searchHybrid } from '../packages/core/src/search/hybrid.ts';
import { loadThresholds } from '../packages/core/src/search/index.ts';
import { getEmbedder } from '../packages/core/src/search/embed.ts';

loadEnv();

const dbPath = process.argv[2] || (existsSync(buildStagingDbPath()) ? buildStagingDbPath() : defaultDbPath());
if (!existsSync(dbPath)) {
  console.error(`Missing DB at ${dbPath}`);
  process.exit(1);
}

const bank = loadBank('pin-nl.jsonl');
if (!bank.length) {
  console.error(`No pin-nl.jsonl under ${evalDataDir()} — run ground with pins first`);
  process.exit(1);
}

const db = openDb(dbPath, { readonly: false });
finalizeSearchIndex(db);
const embedder = await getEmbedder({ forceMock: false });
const thresholds = loadThresholds();
const verbs = loadGitVerbs(db);

let shown = 0;
let hidden = 0;
for (const q of bank.slice(0, 40)) {
  const res = await searchHybrid({
    query: q.query_text,
    thresholds,
    preferredSkillOverride: null,
    verbs,
    embed: () => embedder.embed(q.query_text),
    knn: (vec, k) => knnRecall(db, vec, k),
    fts: (qq, k) => ftsRecall(db, qq, k),
    hydrate: (ids) =>
      ids.map((id) => {
        const row = getCommand(db, id);
        if (!row) {
          return { command_id: id, commands: [], example: '', snippet: '', risk: 0 };
        }
        const commands = parseCommands(row.command_recipe);
        return {
          command_id: Number(row.row_id),
          commands,
          example: primaryCommand(commands) || '',
          snippet: renderSnippet(commands),
          risk: Number(row.risk ?? 0),
        };
      }),
  });
  const n = (res.displayResults || []).length;
  if (n > 0) shown += 1;
  else hidden += 1;
  console.log(
    JSON.stringify({
      q: q.query_text,
      display: n,
      internal: (res.results || []).length,
      top: res.results?.[0]?.commands?.[0]?.command,
    }),
  );
}
db.close();
console.log(JSON.stringify({ shown, hidden, sampled: Math.min(40, bank.length), dbPath }, null, 2));
process.exit(hidden > shown ? 1 : 0);
