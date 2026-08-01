import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT, defaultDbPath } from './lib/paths.js';
import {
  openDb,
  insertCommand,
  insertIntentWithEmbedding,
  insertCommandEmbedding,
  listCommands,
  loadAllRows,
  countCommands,
  countIntents,
  finalizeSearchIndex,
  stripVecCommandsForShip,
} from './db/schema.js';
import { getEmbedder } from './search/embed.js';
import { writeChecksumFile } from './lib/checksum.js';
import { parseCommands } from './db/recipeFormat.js';
import { CommandRowSchema, IntentRowSchema } from './schemas/command.js';

/**
 * Write catalog JSON exports from an open/v6 DB (for bundling / inspect).
 */
export function exportCatalogFromDb(db, {
  commandsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'commands.json'),
  intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl'),
} = {}) {
  mkdirSync(path.dirname(commandsPath), { recursive: true });
  const commands = listCommands(db).map((r) => ({
    row_id: r.row_id,
    initial_state: r.initial_state,
    command_recipe: JSON.parse(r.command_recipe),
    initial_state_physical_hash: r.initial_state_physical_hash,
    final_state_physical_hash: r.final_state_physical_hash,
    risk: r.risk,
    parent_row_id: r.parent_row_id,
  }));
  writeFileSync(commandsPath, `${JSON.stringify(commands, null, 2)}\n`);
  const intents = loadAllRows(db).map((r) => ({
    row_id: Number(r.id),
    command_id: r.command_id,
    skill_level: r.skill_level_text,
    intent_category: r.intent_category,
    intent_text: r.intent_text,
  }));
  writeFileSync(
    intentsPath,
    intents.map((i) => JSON.stringify(i)).join('\n') + (intents.length ? '\n' : ''),
  );
  return { commands: commands.length, intents: intents.length, commandsPath, intentsPath };
}

/**
 * Embed commands.json + intents.jsonl into a fresh schema-v6 DB + checksum.
 */
export async function seedCatalog({
  commandsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'commands.json'),
  intentsPath = path.join(PACKAGE_ROOT, 'data', 'catalog', 'intents.jsonl'),
  dbPath = defaultDbPath(),
  forceMock = process.env.GIT_GRASP_MOCK_EMBEDDINGS === '1',
} = {}) {
  if (!existsSync(commandsPath)) {
    const err = new Error(`Missing commands.json at ${commandsPath} — run build:loop first`);
    err.code = 'SEED';
    throw err;
  }
  if (!existsSync(intentsPath)) {
    const err = new Error(`Missing intents.jsonl at ${intentsPath} — run build:loop first`);
    err.code = 'SEED';
    throw err;
  }

  const commands = JSON.parse(readFileSync(commandsPath, 'utf8'));
  if (!Array.isArray(commands) || commands.length === 0) {
    const err = new Error('commands.json is empty');
    err.code = 'SEED';
    throw err;
  }

  const embedder = await getEmbedder({ forceMock });

  try {
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}.sha256`, { force: true });
  } catch {
    /* */
  }

  const db = openDb(dbPath);
  let commandCount = 0;
  let skipped = 0;
  const idMap = new Map();

  for (const raw of commands) {
    const parsed = CommandRowSchema.safeParse({
      ...raw,
      command_recipe:
        typeof raw.command_recipe === 'string'
          ? JSON.parse(raw.command_recipe)
          : raw.command_recipe,
    });
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    const row_id = insertCommand(db, parsed.data);
    if (raw.row_id != null) idMap.set(raw.row_id, row_id);
    idMap.set(row_id, row_id);
    const text = `${parsed.data.initial_state}\n${parseCommands(parsed.data.command_recipe)
      .map((s) => s.command)
      .join('\n')}`;
    insertCommandEmbedding(db, row_id, await embedder.embed(text));
    commandCount += 1;
  }

  const intentLines = readFileSync(intentsPath, 'utf8').split('\n').filter(Boolean);
  let n = 0;
  for (const line of intentLines) {
    let raw;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    const command_id = idMap.get(raw.command_id) ?? raw.command_id;
    const parsed = IntentRowSchema.safeParse({ ...raw, command_id });
    if (!parsed.success) {
      skipped += 1;
      continue;
    }
    insertIntentWithEmbedding(db, {
      ...parsed.data,
      embedding: await embedder.embed(parsed.data.intent_text),
    });
    n += 1;
  }

  finalizeSearchIndex(db);
  stripVecCommandsForShip(db);

  db.close();
  const hash = writeChecksumFile(dbPath);
  return {
    n,
    recipes: commandCount,
    commands: commandCount,
    skipped,
    dbPath,
    hash,
    mock: embedder.mock === true || forceMock,
  };
}

/** Finalize a promoted DB with checksum + catalog export. */
export function finalizePromotedDb(dbPath = defaultDbPath()) {
  const db = openDb(dbPath);
  finalizeSearchIndex(db);
  stripVecCommandsForShip(db);
  const exported = exportCatalogFromDb(db);
  const commands = countCommands(db);
  const intents = countIntents(db);
  db.close();
  const hash = writeChecksumFile(dbPath);
  return { hash, commands, intents, ...exported };
}
