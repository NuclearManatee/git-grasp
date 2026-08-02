// @ts-nocheck
import { z } from 'zod';

export const EvalMissClassSchema = z.enum([
  'partial_multistep',
  'over_ask',
  'retrieval_sibling',
  'destructive_alt',
  'other',
]);

export const RewriteEvalContextItemSchema = z.object({
  command_id: z.number().int().positive(),
  query_text: z.string().min(1).max(500),
  class: EvalMissClassSchema,
  constraint: z.string().min(1).max(400),
  suggested_angle: z.string().min(1).max(400),
});

export const RewriteEvalContextBatchSchema = z.object({
  items: z.array(RewriteEvalContextItemSchema).max(32),
});

export const RewriteEvalGoldenActionSchema = z.object({
  command_id: z.number().int().positive(),
  op: z.enum(['rewrite', 'drop']),
  query_text: z.string().min(1).max(500).optional(),
});

export const RewriteEvalGoldenBatchSchema = z.object({
  actions: z.array(RewriteEvalGoldenActionSchema).max(32),
});
