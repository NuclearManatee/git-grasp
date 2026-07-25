/**
 * Central LLM provider registry.
 * DeepSeek V4 Pro is the default (OpenAI-compatible chat completions).
 * @see https://api-docs.deepseek.com/
 * @see https://api-docs.deepseek.com/quick_start/rate_limit/
 */

export const PROVIDERS = Object.freeze({
  deepseek: Object.freeze({
    id: 'deepseek',
    name: 'DeepSeek',
    envKey: 'DEEPSEEK_API_KEY',
    baseUrl: 'https://api.deepseek.com',
    chatPath: '/chat/completions',
    defaultModel: 'deepseek-v4-pro',
    /** Account concurrency cap for deepseek-v4-pro (official docs). */
    concurrencyLimit: 500,
    /** Safe default for this project (well under account cap). */
    defaultConcurrency: 16,
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
  groq: Object.freeze({
    id: 'groq',
    name: 'Groq',
    envKey: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatPath: '/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    concurrencyLimit: 1,
    defaultConcurrency: 1,
    supportsJsonObject: true,
    defaultThinking: null,
    softLimits: Object.freeze({
      rpm: 30,
      rpd: 1000,
      tpm: 8000,
      tpd: 200_000,
    }),
  }),
});

export function resolveProviderId(explicit = null) {
  const fromEnv = (process.env.GIT_HELP_LLM_PROVIDER || '').trim().toLowerCase();
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
