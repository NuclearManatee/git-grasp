import { z } from 'zod';

export const EvalLoopFocusSchema = z.object({
  caseIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  queries: z.array(z.string()).optional(),
  rationale: z.string().optional(),
}).passthrough();

export type EvalLoopFocus = z.infer<typeof EvalLoopFocusSchema>;

export const EvalLoopStateSchema = z.object({
  schemaVersion: z.number().int().default(1),
  cycle: z.number().int().nonnegative().optional(),
  focus: EvalLoopFocusSchema.optional(),
}).passthrough();

export type EvalLoopState = z.infer<typeof EvalLoopStateSchema>;

export const EvalLoopFocusLlmResponseSchema = z.object({
  focusTopics: z.array(z.string()).optional().default([]),
  focusCommands: z.array(z.string()).optional().default([]),
  rationale: z.string().optional().default(''),
}).passthrough();
