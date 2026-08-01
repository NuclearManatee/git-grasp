// @ts-nocheck
/**
 * Slim surface for the CLI search path ÔÇö avoid loading seed/catalog/eval via the barrel.
 */
export { search, loadThresholds } from './search/index.js';
export {
  getEmbedder,
  mockEmbed,
  isEmbeddingModelCached,
  embeddingModelId,
} from './search/embed.js';
export {
  formatSearchResult,
  primaryCommand,
} from './ux/format.js';
export { readConfig, writeConfig, configFilePath } from './lib/config.js';
export {
  maybeInviteAndTrackSearch,
  maybeRunTelemetryInvite,
  setTelemetryEnabled,
  telemetryStatus,
  telemetryStatusDetail,
  isTelemetryEnabled,
  shouldPromptInvite,
  buildCliOptInEvent,
  sendUmamiEvent,
  PRIVACY_URL,
} from './lib/telemetry/index.js';
export {
  parseSkillLevel,
  skillName,
  SKILL_NAMES,
  SKILL_MIN,
  SKILL_MAX,
} from './lib/skills.js';
export {
  verifyFileChecksum,
  writeChecksumFile,
} from './lib/checksum.js';
export {
  PACKAGE_ROOT,
  packageDataDir,
  defaultDbPath,
  defaultThresholdsPath,
  userPaths,
} from './lib/paths.js';
export {
  smokeTestSqliteVec,
  SCHEMA_VERSION,
} from './db/schema.js';
