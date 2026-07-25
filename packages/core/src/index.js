/** @git-help/core public facades — apps should import from here when possible. */

export {
  SCHEMA_VERSION,
  EMBEDDING_DIM,
  DEFAULT_RECALL_K,
} from './db/constants.js';

export {
  distanceToSimilarity,
  cosineSimilarity,
  normalizeUsage,
} from './db/utils.js';

export {
  openDb,
  openCatalog,
  insertCommandRow,
  knnRecall,
  loadAllRows,
  dbExists,
  smokeTestSqliteVec,
  loadSqliteVec,
} from './db/schema.js';

export {
  BunSqliteAdapter,
  BrowserStubAdapter,
  getStorageAdapter,
  setStorageAdapter,
  useBunSqliteAdapter,
  useBrowserStubAdapter,
} from './db/adapter.js';

export { search, loadThresholds } from './search/index.js';
export {
  getEmbedder,
  mockEmbed,
  isEmbeddingModelCached,
  embeddingModelId,
  resetEmbedderForTests,
} from './search/embed.js';
export {
  benchEnabled,
  benchTakeLast,
} from './search/benchTiming.js';
export {
  rankResults,
  normalizeQuery,
  confidenceTier,
  preferSpecificExamples,
  preferSimplestInFamily,
} from './search/rank.js';

export { seedCatalog } from './seed.js';

export {
  PACKAGE_ROOT,
  packageDataDir,
  defaultDbPath,
  defaultThresholdsPath,
  userPaths,
  resolveUnderRoot,
} from './lib/paths.js';

export { verifyFileChecksum, writeChecksumFile } from './lib/checksum.js';
export { readConfig, writeConfig, configFilePath } from './lib/config.js';
export {
  parseSkillLevel,
  skillName,
  skillAtMost,
  SKILL_NAMES,
  SKILL_MIN,
  SKILL_MAX,
} from './lib/skills.js';
export { validateIntentRow } from './lib/validator.js';
export { formatSearchResult, primaryCommand } from './ux/format.js';
