// @ts-nocheck
import { z } from 'zod';

export const GlossarySchema = z.object({
  branch: z.array(z.string()).default([]),
  file: z.array(z.string()).default([]),
  url: z.array(z.string()).default([]),
  message: z.array(z.string()).default([]),
  commit: z.array(z.string()).default([]),
  name: z.array(z.string()).default([]),
  path: z.array(z.string()).default([]),
  pattern: z.array(z.string()).default([]),
  email: z.array(z.string()).default([]),
  other: z.array(z.string()).default([]),
}).passthrough();

export type Glossary = z.infer<typeof GlossarySchema>;

/** LLM glossary response â€” same shape, all keys optional arrays for partial merges. */
export const GlossaryLlmResponseSchema = z.record(z.string(), z.array(z.string())).or(GlossarySchema);
