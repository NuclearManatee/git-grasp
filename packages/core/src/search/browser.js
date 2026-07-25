/**
 * In-browser semantic search using a static web vector pack.
 * Must not import bun:sqlite / schema.js.
 */

import { DEFAULT_RECALL_K } from '../db/constants.js';
import { skillName } from '../lib/skills.js';
import { rankResults, normalizeQuery } from './rank.js';
import { decodeWebPack, knnWebPack, sha256Hex } from './webPack.js';
import { getBrowserEmbedder } from './embed.browser.js';

/** @type {import('./webPack.js').WebPackHandle | null} */
let cachedPack = null;

/**
 * Load (and optionally verify) a web pack from bytes.
 * @param {ArrayBuffer | Uint8Array} data
 * @param {{ expectedSha256?: string | null }} [opts]
 */
export async function openWebPack(data, { expectedSha256 = null } = {}) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (expectedSha256) {
    const actual = await sha256Hex(bytes);
    if (actual !== expectedSha256.toLowerCase()) {
      const err = new Error('Web pack integrity check failed: mismatch');
      err.code = 'INTEGRITY';
      err.detail = { expected: expectedSha256, actual };
      throw err;
    }
  }
  const pack = decodeWebPack(bytes);
  if (expectedSha256) pack.sha256 = expectedSha256.toLowerCase();
  cachedPack = pack;
  return pack;
}

export function getOpenWebPack() {
  return cachedPack;
}

export function resetWebPackForTests() {
  cachedPack = null;
}

/**
 * @param {string} query
 * @param {{
 *   pack?: import('./webPack.js').WebPackHandle,
 *   forceMockEmbeddings?: boolean,
 *   skillLevelOverride?: number | null,
 *   recallK?: number,
 *   onEmbedStatus?: (msg: string) => void,
 * }} [opts]
 */
export async function searchBrowser(query, {
  pack = cachedPack,
  forceMockEmbeddings = false,
  skillLevelOverride = null,
  recallK = undefined,
  onEmbedStatus = undefined,
} = {}) {
  if (!pack) {
    const err = new Error('Web pack not loaded. Call openWebPack first.');
    err.code = 'INTEGRITY';
    throw err;
  }

  const embedder = await getBrowserEmbedder({
    forceMock: forceMockEmbeddings,
    onStatus: onEmbedStatus,
  });

  const thresholds = pack.thresholds;
  const skillLevel = skillLevelOverride;
  const q = normalizeQuery(query, thresholds.normalizeQuery !== false);
  if (!q) {
    const err = new Error('Empty query');
    err.code = 'USAGE';
    throw err;
  }

  const embedding = await embedder.embed(q);
  const topK = thresholds.topK ?? 5;
  const k = recallK ?? Math.max(DEFAULT_RECALL_K, topK * 10);

  const candidates = knnWebPack(pack, embedding, k, {
    maxSkillLevel: skillLevel != null ? skillLevel : null,
  });

  const ranked = rankResults(candidates, embedding, thresholds, { skillLevel });

  if (ranked.status === 'empty' && skillLevel != null) {
    const err = new Error(
      `No results for skill ≤ ${skillName(skillLevel)}. Try: set-level clear`,
    );
    err.code = 'FILTER_EMPTY';
    throw err;
  }

  return {
    ...ranked,
    query: q,
    skillFilter: skillLevel,
    embedderMock: embedder.mock,
  };
}
