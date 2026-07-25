import { createClient } from '@libsql/client';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 3;
export const EMBEDDING_DIM = 384;

export const DDL = `
CREATE TABLE IF NOT EXISTS git_commands (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  example TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT '',
  intent_family TEXT NOT NULL DEFAULT '',
  simplicity_rank INTEGER NOT NULL DEFAULT 1,
  skill_level INTEGER NOT NULL CHECK (skill_level BETWEEN 1 AND 4),
  intent_description TEXT NOT NULL,
  embedding F32_BLOB NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  schema_version INTEGER NOT NULL DEFAULT 3
);
CREATE INDEX IF NOT EXISTS idx_git_commands_skill ON git_commands(skill_level);
CREATE INDEX IF NOT EXISTS idx_git_commands_command ON git_commands(command);
CREATE INDEX IF NOT EXISTS idx_git_commands_example ON git_commands(example);
CREATE INDEX IF NOT EXISTS idx_git_commands_family ON git_commands(intent_family);
`;

export function float32ToBlob(arr) {
  const f32 = arr instanceof Float32Array ? arr : new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function blobToFloat32(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

export function cosineSimilarity(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Normalize usage to "command_line\\nblurb" form.
 * @param {string | { command_line?: string, blurb?: string } | null | undefined} usage
 * @param {string} [fallbackExample]
 */
export function normalizeUsage(usage, fallbackExample = '') {
  if (usage && typeof usage === 'object') {
    const line = String(usage.command_line || fallbackExample || '').trim();
    const blurb = String(usage.blurb || '').trim();
    return blurb ? `${line}\n${blurb}` : line;
  }
  const s = String(usage || '').trim();
  if (s) return s;
  return String(fallbackExample || '').trim();
}

export async function openDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const url = `file:${path.resolve(dbPath).replace(/\\/g, '/')}`;
  const client = createClient({ url });
  await client.executeMultiple(DDL);
  await ensureSchemaV3(client);
  return client;
}

/**
 * Recreate table when required v3 columns are missing or legacy risk columns remain alone.
 */
async function ensureSchemaV3(client) {
  const info = await client.execute('PRAGMA table_info(git_commands)');
  const cols = new Set(info.rows.map((r) => r.name));
  const required = ['example', 'intent_family', 'simplicity_rank', 'usage'];
  const missing = required.filter((c) => !cols.has(c));
  const hasLegacyRisk = cols.has('risk_class') || cols.has('risks');
  if (missing.length === 0 && !hasLegacyRisk) return;
  await client.executeMultiple(`
    DROP TABLE IF EXISTS git_commands;
    ${DDL}
  `);
}

export async function insertCommandRow(client, row) {
  const example = row.example ?? row.command;
  const usage = normalizeUsage(row.usage, example);
  await client.execute({
    sql: `INSERT OR REPLACE INTO git_commands
      (id, command, example, usage, intent_family, simplicity_rank, skill_level, intent_description,
       embedding, explanation, schema_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.command,
      example,
      usage,
      row.intent_family ?? '',
      row.simplicity_rank ?? 1,
      row.skill_level,
      row.intent_description,
      float32ToBlob(row.embedding),
      row.explanation ?? '',
      SCHEMA_VERSION,
    ],
  });
}

export async function loadAllRows(client) {
  const rs = await client.execute('SELECT * FROM git_commands');
  return rs.rows.map((r) => ({
    id: r.id,
    command: r.command,
    example: r.example ?? r.command,
    usage: r.usage ?? r.example ?? r.command,
    intent_family: r.intent_family ?? '',
    simplicity_rank: Number(r.simplicity_rank ?? 1),
    skill_level: Number(r.skill_level),
    intent_description: r.intent_description,
    embedding: blobToFloat32(r.embedding),
    explanation: r.explanation,
    schema_version: Number(r.schema_version),
  }));
}

export function dbExists(dbPath) {
  return existsSync(dbPath);
}
