// @ts-nocheck
/**
 * Central LLM provider registry.
 * DeepSeek V4 Flash is the default chat model (OpenAI-compatible chat completions).
 * Official API slug: `deepseek-v4-flash` (see Models & Pricing docs).
 * Matrix judge uses Pro explicitly; catalog ground/loop stay on Flash.
 * @see https://api-docs.deepseek.com/
 * @see https://api-docs.deepseek.com/quick_start/pricing/
 * @see https://api-docs.deepseek.com/quick_start/rate_limit/
 */

/** Default catalog / generation model. */
export const DEEPSEEK_FLASH_MODEL = 'deepseek-v4-flash';

/** Intent-matrix blind judge only. */
export const DEEPSEEK_PRO_MODEL = 'deepseek-v4-pro';

export const PROVIDERS = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    defaultModel: DEEPSEEK_FLASH_MODEL,
    /** Account concurrency cap for deepseek-v4-flash (official docs). */
    concurrencyLimit: 2500,
    /** Safe default for this project (well under account cap). */
    defaultConcurrency: 64,
    supportsJsonObject: true,
    /** Disable thinking mode for faster catalog/eval JSON calls. */
    defaultThinking: Object.freeze({ type: 'disabled' }),
    /** Soft client-side budgets (DeepSeek has no official RPM/TPM caps). */
    softLimits: Object.freeze({
      rpm: 0, // 0 = unlimited
      rpd: 0,
      tpm: 0,
      tpd: 0,
    }),
  }),
});

export function resolveProviderId(explicit = null) {
  const fromEnv = (process.env.GIT_GRASP_LLM_PROVIDER || '').trim().toLowerCase();
  const id = (explicit || fromEnv || 'deepseek').toLowerCase();
  if (!PROVIDERS[id]) {
    throw new Error(`Unknown LLM provider "${id}". Use: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return id;
}

export function getProvider(explicit = null) {
  return PROVIDERS[resolveProviderId(explicit)];
}

export function chatCompletionsUrl(provider = getProvider()) {
  return `${provider.baseUrl.replace(/\/$/, '')}${provider.chatPath}`;
}
