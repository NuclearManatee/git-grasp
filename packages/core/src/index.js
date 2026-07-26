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
  insertRecipe,
  insertIntentWithEmbedding,
  insertCommandRow,
  knnRecall,
  loadAllRows,
  parseCommands,
  renderSnippet,
  dbExists,
  smokeTestSqliteVec,
  loadSqliteVec,
} from './db/schema.js';

export {
  serializeCommands,
} from './db/recipeFormat.js';

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
  openWebPack,
  searchBrowser,
  resetWebPackForTests,
} from './search/browser.js';
export {
  getEmbedder,
  mockEmbed,
  isEmbeddingModelCached,
  embeddingModelId,
  embeddingModelRevision,
  resetEmbedderForTests,
} from './search/embed.js';
export {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_REVISION,
} from './search/embeddingModel.js';
export { assertSecureConfigFile, readConfig, writeConfig, configFilePath } from './lib/config.js';
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
