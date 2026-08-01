import { z } from 'zod';

export const LlmEnvSchema = z.object({
  GIT_GRASP_LLM_MODEL: z.string().optional(),
  GIT_GRASP_LLM_TIMEOUT_MS: z.string().optional(),
  GIT_GRASP_LLM_MAX_TOKENS: z.string().optional(),
  GIT_GRASP_LLM_PROVIDER: z.string().optional(),
  GIT_GRASP_TLS_INSECURE: z.string().optional(),
  GIT_GRASP_MOCK_EMBEDDINGS: z.string().optional(),
  GIT_GRASP_MOCK_JUDGE: z.string().optional(),
  GIT_GRASP_SKIP_POSTINSTALL: z.string().optional(),
}).passthrough();

export type LlmEnv = z.infer<typeof LlmEnvSchema>;

export function parseLlmEnv(env: NodeJS.ProcessEnv = process.env): LlmEnv {
  return LlmEnvSchema.parse(env);
}
