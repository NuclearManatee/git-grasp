// @ts-nocheck
/** @git-grasp/common public facades — apps should import from here when possible. */

export {
  SCHEMA_VERSION,
  EMBEDDING_DIM,
  DEFAULT_RECALL_K,
  SEARCH_ALGORITHM_VERSION,
} from './db/constants.js';

export {
  distanceToSimilarity,
  cosineSimilarity,
  normalizeUsage,
} from './db/utils.js';

export {
  openDb,
  openCatalog,
  insertCommand,
  insertRecipe,
  insertIntentWithEmbedding,
  insertCommandEmbedding,
  knnRecall,
  knnRecallRecipes,
  knnRecallCommands,
  ftsRecall,
  rebuildCommandsFts,
  rebuildRecipesFts,
  finalizeSearchIndex,
  stripVecCommandsForShip,
  loadAllRows,
  parseCommands,
  renderSnippet,
  dbExists,
  smokeTestSqliteVec,
  loadSqliteVec,
  promoteStagingDb,
  countCommands,
  countRecipes,
  countIntents,
  commandFingerprint,
  getRecipe,
  listRecipes,
  listRecipesByLeaf,
  findRecipeByFingerprint,
  appendParaphrase,
  hydrateRecipeHit,
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
export { searchHybrid, normalizeQuery } from './search/hybrid.js';
export {
  openWebPack,
  openWebCatalog,
  searchBrowser,
  resetWebPackForTests,
} from './search/browser.js';
export { exportWebCatalog } from './search/webCatalog.js';
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

export { seedCatalog } from './seed.js';

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
export * from './schemas/index.js';

/** Stage facades (PREPARE → … → EVOLVE). Prefer these for new code. */
export * as prepare from './prepare/index.js';
export * as generate from './generate/index.js';
export * as expand from './expand/index.js';
export * as ship from './ship/index.js';
export * as observe from './observe/index.js';
export * as evolve from './evolve/index.js';
// search already lives at ./search — keep direct imports; stage alias:
export * as searchStage from './search/index.js';
