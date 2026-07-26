/**
 * Browser vector pack — static catalog for in-browser KNN (no bun:sqlite).
 *
 * Binary layout (little-endian):
 *   magic "GHPK" (4)
 *   version u32
 *   dim u32
 *   rowCount u32
 *   thresholdsJsonLen u32 + utf8
 *   for each row:
 *     metaJsonLen u32 + utf8 meta (no embedding)
 *     embedding: dim * float32
 */

import { EMBEDDING_DIM } from '../db/constants.js';

export const WEB_PACK_MAGIC = 0x4b504847; // 'GHPK' LE
export const WEB_PACK_VERSION = 1;
export const WEB_PACK_MAX_ROWS = 100_000;
export const WEB_PACK_MAX_THRESHOLDS_JSON = 256 * 1024;
export const WEB_PACK_MAX_META_JSON = 64 * 1024;

function integrityError(message) {
  return Object.assign(new Error(message), { code: 'INTEGRITY' });
}

function needBytes(bytes, offset, length, label) {
  if (length < 0 || offset + length > bytes.byteLength) {
    throw integrityError(`Web pack truncated reading ${label}`);
  }
}

/**
 * @typedef {object} WebPackMeta
 * @property {string} id
 * @property {string} [recipe_id]
 * @property {string} [title]
 * @property {string} command
 * @property {string} example
 * @property {string} usage
 * @property {string} intent_family
 * @property {number} simplicity_rank
 * @property {number} skill_level
 * @property {string} intent_description
 * @property {string} explanation
 * @property {number} schema_version
 * @property {Array<{ run: string, comment?: string }>|string} [commands]
 * @property {string} [topic]
 * @property {string} [snippet]
 */

/**
 * @typedef {object} WebPackHandle
 * @property {string} name
 * @property {number} version
 * @property {number} dim
 * @property {object} thresholds
 * @property {Array<WebPackMeta & { embedding: Float32Array }>} rows
 * @property {string} [sha256]
 */

/**
 * Encode a pack from rows + thresholds (Node/Bun export).
 * @param {{
 *   dim: number,
 *   thresholds: object,
 *   rows: Array<WebPackMeta & { embedding: Float32Array | Uint8Array | number[] }>,
 * }} input
 * @returns {Uint8Array}
 */
export function encodeWebPack({ dim, thresholds, rows }) {
  const thresholdsJson = new TextEncoder().encode(JSON.stringify(thresholds));
  const metaParts = rows.map((r) => {
    const meta = {
      id: r.id,
      recipe_id: r.recipe_id ?? undefined,
      title: r.title ?? undefined,
      command: r.command,
      example: r.example,
      usage: r.usage ?? '',
      intent_family: r.intent_family ?? '',
      simplicity_rank: Number(r.simplicity_rank ?? 1),
      skill_level: Number(r.skill_level),
      intent_description: r.intent_description || r.intent_text,
      explanation: r.explanation ?? '',
      schema_version: Number(r.schema_version ?? 5),
      topic: r.topic ?? undefined,
      commands: r.commands ?? undefined,
      snippet: r.snippet ?? undefined,
    };
    return new TextEncoder().encode(JSON.stringify(meta));
  });

  let total = 4 + 4 + 4 + 4 + 4 + thresholdsJson.length;
  for (let i = 0; i < rows.length; i += 1) {
    total += 4 + metaParts[i].length + dim * 4;
  }

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  let o = 0;

  view.setUint32(o, WEB_PACK_MAGIC, true); o += 4;
  view.setUint32(o, WEB_PACK_VERSION, true); o += 4;
  view.setUint32(o, dim, true); o += 4;
  view.setUint32(o, rows.length, true); o += 4;
  view.setUint32(o, thresholdsJson.length, true); o += 4;
  out.set(thresholdsJson, o); o += thresholdsJson.length;

  for (let i = 0; i < rows.length; i += 1) {
    const metaBytes = metaParts[i];
    view.setUint32(o, metaBytes.length, true); o += 4;
    out.set(metaBytes, o); o += metaBytes.length;

    const emb = toFloat32(rows[i].embedding, dim);
    const embBytes = new Uint8Array(emb.buffer, emb.byteOffset, emb.byteLength);
    out.set(embBytes, o); o += embBytes.length;
  }

  return out;
}

/**
 * Decode pack from ArrayBuffer / Uint8Array.
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {WebPackHandle}
 */
export function decodeWebPack(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 20) {
    throw integrityError('Web pack too small');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;

  const magic = view.getUint32(o, true); o += 4;
  if (magic !== WEB_PACK_MAGIC) {
    throw integrityError('Invalid web pack magic');
  }
  const version = view.getUint32(o, true); o += 4;
  if (version !== WEB_PACK_VERSION) {
    throw integrityError(`Unsupported web pack version ${version}`);
  }
  const dim = view.getUint32(o, true); o += 4;
  if (dim !== EMBEDDING_DIM) {
    throw integrityError(`Unexpected embedding dim ${dim} (expected ${EMBEDDING_DIM})`);
  }
  const rowCount = view.getUint32(o, true); o += 4;
  if (rowCount > WEB_PACK_MAX_ROWS) {
    throw integrityError(`Web pack rowCount ${rowCount} exceeds max ${WEB_PACK_MAX_ROWS}`);
  }
  const thrLen = view.getUint32(o, true); o += 4;
  if (thrLen > WEB_PACK_MAX_THRESHOLDS_JSON) {
    throw integrityError(`Web pack thresholds JSON too large (${thrLen})`);
  }
  needBytes(bytes, o, thrLen, 'thresholds');
  let thresholds;
  try {
    thresholds = JSON.parse(new TextDecoder().decode(bytes.subarray(o, o + thrLen)));
  } catch {
    throw integrityError('Web pack thresholds JSON invalid');
  }
  o += thrLen;

  /** @type {WebPackHandle['rows']} */
  const rows = [];
  const decoder = new TextDecoder();
  for (let i = 0; i < rowCount; i += 1) {
    needBytes(bytes, o, 4, `row[${i}].metaLen`);
    const metaLen = view.getUint32(o, true); o += 4;
    if (metaLen > WEB_PACK_MAX_META_JSON) {
      throw integrityError(`Web pack meta JSON too large at row ${i}`);
    }
    needBytes(bytes, o, metaLen, `row[${i}].meta`);
    let meta;
    try {
      meta = JSON.parse(decoder.decode(bytes.subarray(o, o + metaLen)));
    } catch {
      throw integrityError(`Web pack meta JSON invalid at row ${i}`);
    }
    o += metaLen;
    const embByteLen = dim * 4;
    needBytes(bytes, o, embByteLen, `row[${i}].embedding`);
    const embBytes = bytes.subarray(o, o + embByteLen);
    o += embByteLen;
    const embedding = new Float32Array(embBytes.buffer.slice(
      embBytes.byteOffset,
      embBytes.byteOffset + embBytes.byteLength,
    ));
    rows.push({ ...meta, embedding });
  }

  if (o !== bytes.byteLength) {
    throw integrityError(`Web pack trailing bytes (${bytes.byteLength - o})`);
  }

  return {
    name: 'browser-vec-pack',
    version,
    dim,
    thresholds,
    rows,
  };
}

/**
 * Brute-force cosine top-K over pack rows.
 * @param {WebPackHandle} handle
 * @param {Float32Array} queryEmbedding
 * @param {number} k
 * @param {{ maxSkillLevel?: number | null }} [opts]
 */
export function knnWebPack(handle, queryEmbedding, k, opts = {}) {
  const want = Math.max(1, Math.floor(k));
  const maxSkill = opts.maxSkillLevel == null ? null : Number(opts.maxSkillLevel);
  const scored = [];

  for (const row of handle.rows) {
    if (maxSkill != null && Number(row.skill_level) > maxSkill) continue;
    const score = cosine(queryEmbedding, row.embedding);
    scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, want);

  return top.map(({ row, score }) => ({
    id: row.id,
    command: row.command,
    example: row.example ?? row.command,
    usage: row.usage ?? row.example ?? row.command,
    intent_family: row.intent_family ?? '',
    simplicity_rank: Number(row.simplicity_rank ?? 1),
    skill_level: Number(row.skill_level),
    intent_description: row.intent_description,
    explanation: row.explanation,
    schema_version: Number(row.schema_version),
    embedding: row.embedding,
    _forcedScore: score,
  }));
}

function cosine(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function toFloat32(embedding, dim) {
  if (embedding instanceof Float32Array) {
    if (embedding.length !== dim) {
      throw new Error(`embedding dim ${embedding.length} !== ${dim}`);
    }
    return embedding;
  }
  if (embedding instanceof Uint8Array) {
    if (embedding.byteLength !== dim * 4) {
      throw new Error(`embedding bytes ${embedding.byteLength} !== ${dim * 4}`);
    }
    return new Float32Array(embedding.buffer, embedding.byteOffset, dim);
  }
  const arr = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) arr[i] = Number(embedding[i] ?? 0);
  return arr;
}

/**
 * Hex SHA-256 of bytes (Web Crypto). Node export script uses checksum.js instead.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('Web Crypto SHA-256 is required');
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
