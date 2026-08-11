// @ts-nocheck
/**
 * Re-expand intents on staging after lexicon trap updates.
 *
 * Quarantined on schema v9 (intents / vec_commands removed). Use leaf holdout
 * + improve triage instead. Legacy body retained in git history if needed.
 */
import { assertV9IntentQuarantine } from '../evalQuarantine.js';

/**
 * @deprecated schema v9 — always throws
 */
export async function reexpandIntentsForStaging(_db, _embedder, _opts = {}) {
  assertV9IntentQuarantine();
}
