// @ts-nocheck
export {
  loadLexiconTraps,
  readLexiconTrapsFile,
  writeLexiconTrapsFile,
  mergeLexiconTrapProposals,
  compileTrapNeedles,
} from './lexiconTraps.js';
export {
  readVerbFamiliesFile,
  writeVerbFamiliesFile,
  buildVerbFamilyIndex,
  verbsInFamily,
  mergeVerbFamilyProposals,
  pruneDistinguishedEvalRoundFamilies,
} from './verbFamilies.js';
export { loadFlagDenylist } from './flagDenylist.js';
export { collectEvalMisses, countEvalMisses } from './collectMisses.js';
export {
  splitTrainHoldoutByCommandId,
  stableCommandIdHash,
} from './splitHoldout.js';
export {
  validateProposalBatch,
  needleCopiesJudgeReason,
  isForbiddenVerbFamilyPair,
  FORBIDDEN_VERB_FAMILY_PAIRS,
  trapEvidenceMeetsGenerality,
  trainMissesMatchingNeedles,
  queryMentionsVerb,
  goldensDistinguishFamilyMembers,
} from './validateProposals.js';
export { reexpandIntentsForStaging } from './reexpandIntents.js';
export {
  runImproveRound,
  shouldAcceptImproveRound,
  metricsForCommandIds,
  applyProposalsToTaxonomy,
  readTaxonomySnapshot,
  restoreTaxonomySnapshot,
} from './runImproveRound.js';
export { maybeRunEvalImprove, shouldRunEvalImprove } from './maybeRunEvalImprove.js';
