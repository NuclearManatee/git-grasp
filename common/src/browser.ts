// @ts-nocheck
/**
 * Slim browser-safe surface — never import bun:sqlite.
 */

export {
  EMBEDDING_DIM,
  SCHEMA_VERSION,
  DEFAULT_RECALL_K,
  SEARCH_ALGORITHM_VERSION,
} from './db/constants.js';
export {
  openWebPack,
  openWebCatalog,
  getOpenWebPack,
  getOpenWebCatalog,
  resetWebPackForTests,
  searchBrowser,
  sha256Hex,
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
export { normalizeQuery } from './search/hybrid.js';
export {
  formatSearchResult,
  primaryCommand,
} from './ux/format.js';
export {
  style,
  statusLine,
  withLink,
  okLine,
  infoLine,
  warnLine,
  cautionLine,
  errorLine,
  withEmoji,
  emojiEnabled,
  resolveEnv,
} from './ux/cliStyle.js';
export {
  msgTelemetryOn,
  msgTelemetryOff,
  msgTelemetryStatusHead,
  msgTelemetryStatusBlock,
  msgTelemetryOffPlayground,
  msgTelemetryStatusPlayground,
  msgSkillCleared,
  msgSkillSet,
  msgInitWarm,
  msgInitWarmMock,
  msgInitReady,
  msgSearchCopyOk,
  msgSearchCopyFail,
} from './ux/messages.js';
export { PRIVACY_URL } from './lib/telemetry/defaults.js';
export {
  parseSkillLevel,
  skillName,
  SKILL_NAMES,
  SKILL_MIN,
  SKILL_MAX,
} from './lib/skills.js';
