/**
 * Slim browser-safe surface — never import bun:sqlite.
 */

export { EMBEDDING_DIM, SCHEMA_VERSION, DEFAULT_RECALL_K } from './db/constants.js';
export {
  encodeWebPack,
  decodeWebPack,
  knnWebPack,
  sha256Hex,
  WEB_PACK_VERSION,
} from './search/webPack.js';
export {
  openWebPack,
  getOpenWebPack,
  resetWebPackForTests,
  searchBrowser,
} from './search/browser.js';
export {
  getBrowserEmbedder,
  mockEmbedBrowser,
  resetBrowserEmbedderForTests,
  BROWSER_EMBEDDING_MODEL,
  BROWSER_EMBEDDING_REVISION,
} from './search/embed.browser.js';
export {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
} from './search/embeddingModel.js';
export { sanitizeField, stripAnsi } from './lib/ansi.js';
export {
  rankResults,
  normalizeQuery,
} from './search/rank.js';
export {
  formatSearchResult,
  primaryCommand,
} from './ux/format.js';
export {
  parseSkillLevel,
  skillName,
  SKILL_NAMES,
  SKILL_MIN,
  SKILL_MAX,
} from './lib/skills.js';

import { decodeWebPack, knnWebPack } from './search/webPack.js';

/**
 * Adapter-shaped wrapper around an open web pack.
 */
export const BrowserVecPackAdapter = {
  name: 'browser-vec-pack',
  /**
   * @param {ArrayBuffer | Uint8Array | object} dataOrHandle
   */
  open(dataOrHandle) {
    if (dataOrHandle && typeof dataOrHandle === 'object' && Array.isArray(dataOrHandle.rows)) {
      return dataOrHandle;
    }
    return decodeWebPack(/** @type {ArrayBuffer | Uint8Array} */ (dataOrHandle));
  },
  knn(handle, queryEmbedding, k, opts) {
    return knnWebPack(handle, queryEmbedding, k, opts);
  },
  insert() {
    /* read-only catalog in browser */
  },
  close() {},
};
