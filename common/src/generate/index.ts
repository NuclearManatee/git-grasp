// @ts-nocheck
/** GENERATE — per-leaf generate → validate → saturate (discovery). */
export { generateLeafBatch } from '../build/leafGenerate.js';
export { validateRecipeCandidate, cheapPlausibilityCheck } from '../build/recipeValidate.js';
export { saturateLeaf, isDiscoveryBatchFlat } from '../build/leafSaturate.js';
export { runGroundStep, selectLeavesForCap } from '../build/orchestrator.js';
export {
  validateInSandbox,
  validateInSandboxAndDestroy,
} from '../build/sandbox.js';
export {
  SANDBOX_FIXTURES,
  inferFixtureForLeaf,
  materializeFixture,
} from '../build/sandboxFixtures.js';
export {
  structuralCommandFingerprint,
  rewriteCommandsPlaceholders,
  normalizeArgvLine,
} from '../build/argvNormalize.js';
