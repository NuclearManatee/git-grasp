// @ts-nocheck
/**
 * Slim surface for the CLI search path — avoid loading seed/catalog/eval via the barrel.
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
  formatSearchResultJson,
  primaryCommand,
} from './ux/format.js';
export { style, statusLine, withLink, doctorPaint, okLine, infoLine, warnLine, cautionLine, errorLine, withEmoji, emojiEnabled, resolveEnv } from './ux/cliStyle.js';
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
  msgUpdateOn,
  msgUpdateOff,
} from './ux/messages.js';
export { readConfig, writeConfig, configFilePath } from './lib/config.js';
export {
  maybeInviteAndTrackSearch,
  maybeRunTelemetryInvite,
  setTelemetryEnabled,
  telemetryStatus,
  telemetryStatusDetail,
  isHardOff,
  isTelemetryEnabled,
  shouldPromptInvite,
  buildCliOptInEvent,
  sendPosthogEvent,
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
  commonDir,
  localDir,
  catalogDir,
  evalDataDir,
  defaultDbPath,
  defaultThresholdsPath,
  goldenCasesPath,
  judgeCriteriaPath,
  userPaths,
} from './lib/paths.js';
export {
  smokeTestSqliteVec,
  SCHEMA_VERSION,
  getMetaValue,
  openDb,
} from './db/schema.js';
export {
  appVersion,
  catalogIdentity,
  collectVersionIdentity,
  formatVersionReport,
} from './lib/version.js';
export {
  maybeNotifyUpdate,
  checkForUpdate,
  setUpdateCheckEnabled,
  updateCheckStatusDetail,
  isUpdateCheckEnabled,
  compareSemver,
  fetchNpmLatestVersion,
  readUpdateCache,
  writeUpdateCache,
} from './lib/updateCheck.js';
export { completionScript } from './lib/completion.js';
