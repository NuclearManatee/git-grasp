export const V9_INTENT_QUARANTINE =
  'schema v9: intent recovery/improve disabled; use leaf holdout + improve triage';

export function assertV9IntentQuarantine() {
  const err = new Error(V9_INTENT_QUARANTINE) as Error & { code: string };
  err.code = 'V9_INTENT_QUARANTINE';
  throw err;
}
