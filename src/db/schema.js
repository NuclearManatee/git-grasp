import { createClient } from '@libsql/client';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const EMBEDDING_DIM = 384;

export const DDL = `
CREATE TABLE IF NOT EXISTS git_commands (
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  skill_level INTEGER NOT NULL CHECK (skill_level BETWEEN 1 AND 5),
  intent_description TEXT NOT NULL,
  embedding F32_BLOB NOT NULL,
  explanation TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  examples TEXT NOT NULL DEFAULT '',
  risk_class TEXT NOT NULL DEFAULT 'none'
    CHECK (risk_class IN ('none', 'low', 'high', 'destructive')),
  schema_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_git_commands_skill ON git_commands(skill_level);
CREATE INDEX IF NOT EXISTS idx_git_commands_command ON git_commands(command);
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

export async function openDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const url = `file:${path.resolve(dbPath).replace(/\\/g, '/')}`;
  const client = createClient({ url });
  await client.executeMultiple(DDL);
  return client;
}

export async function insertCommandRow(client, row) {
  await client.execute({
    sql: `INSERT OR REPLACE INTO git_commands
      (id, command, skill_level, intent_description, embedding, explanation, risks, examples, risk_class, schema_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      row.id,
      row.command,
      row.skill_level,
      row.intent_description,
      float32ToBlob(row.embedding),
      row.explanation ?? '',
      row.risks ?? '',
      row.examples ?? '',
      row.risk_class ?? 'none',
      SCHEMA_VERSION,
    ],
  });
}

export async function loadAllRows(client) {
  const rs = await client.execute('SELECT * FROM git_commands');
  return rs.rows.map((r) => ({
    id: r.id,
    command: r.command,
    skill_level: Number(r.skill_level),
    intent_description: r.intent_description,
    embedding: blobToFloat32(r.embedding),
    explanation: r.explanation,
    risks: r.risks,
    examples: r.examples,
    risk_class: r.risk_class,
    schema_version: Number(r.schema_version),
  }));
}

export function dbExists(dbPath) {
  return existsSync(dbPath);
}
