// @ts-nocheck
import { z } from 'zod';

export const SkillLevelTextSchema = z.enum([
  'nontechnical',
  'beginner',
  'intermediate',
  'expert',
]);

export const IntentCategorySchema = z.enum([
  'goal',
  'error_message',
  'symptom',
  'conversational',
]);

export const CommandRecipeStepSchema = z.object({
  command: z.string().min(1),
  comment: z.string().optional().default(''),
});

export const CommandRecipeSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  // LLM sometimes returns a bare commands array
  if (Array.isArray(val)) return { commands: val };
  return val;
}, z.object({
  commands: z.array(CommandRecipeStepSchema).min(1),
}));

export const CommandRowSchema = z.object({
  row_id: z.number().int().positive().optional(),
  initial_state: z.string().min(1),
  command_recipe: CommandRecipeSchema,
  initial_state_physical_hash: z.string().min(1),
  final_state_physical_hash: z.string().min(1),
  risk: z.number().min(0).max(1),
  parent_row_id: z.number().int().positive().nullable().optional(),
  mutation_kind: z.enum(['state', 'flag', 'composition']).nullable().optional(),
});

export const IntentRowSchema = z.object({
  row_id: z.number().int().positive().optional(),
  command_id: z.number().int().positive(),
  skill_level: SkillLevelTextSchema,
  intent_category: IntentCategorySchema,
  intent_text: z.string().min(1).max(2000),
});

export const GenerationLlmResponseSchema = z.object({
  initial_state: z.string().min(1),
  command_recipe: CommandRecipeSchema,
  risk: z.union([z.number(), z.string()]).transform((v) => Number(v)).pipe(z.number().min(0).max(1)),
});

export const IntentExpansionItemSchema = z.object({
  skill_level: SkillLevelTextSchema,
  intent_category: IntentCategorySchema,
  intent_text: z.string().min(1).max(2000),
});

export const IntentExpandSkipSchema = z.object({
  skill_level: SkillLevelTextSchema,
  intent_category: IntentCategorySchema,
  reason: z
    .string()
    .max(500)
    .optional()
    .transform((v) => (v && String(v).trim() ? String(v).trim() : 'unspecified')),
});

/** Wrapper required by providers that enforce response_format=json_object. */
export const IntentExpansionLlmResponseSchema = z.object({
  intents: z.array(IntentExpansionItemSchema).min(1).max(16),
});

/**
 * Iterative expand batch: intents for empty cells and/or honest skips.
 * At least one intent or one skip required.
 */
export const IntentExpandBatchLlmResponseSchema = z
  .object({
    intents: z.array(IntentExpansionItemSchema).max(16).default([]),
    skips: z.array(IntentExpandSkipSchema).max(16).default([]),
  })
  .superRefine((val, ctx) => {
    if ((val.intents?.length || 0) + (val.skips?.length || 0) < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Need at least one intent or one skip',
      });
    }
  });

/** Contrastive rewrite after foreign collision. */
export const IntentRewriteLlmResponseSchema = z.object({
  intent_text: z.string().min(1).max(2000),
});

export const IntentExpansionArraySchema = z
  .array(IntentExpansionItemSchema)
  .min(1)
  .max(32);

export const StrictJudgeSchema = z.object({
  utility: z.number().min(0).max(1),
  reason: z.string().min(1),
});

export const SemanticBlockChildSchema = z.object({
  metadata_source: z.string().min(1),
  content: z.string().min(1),
});

export const SemanticBlockSchema = z.object({
  command: z.string().min(1),
  blocks: z.array(SemanticBlockChildSchema).min(1),
});

export const SemanticBlocksFileSchema = z.array(SemanticBlockSchema);

/** @deprecated Use SemanticBlockChildSchema â€” kept alias for chunk origins during prepare. */
export const ClusterChunkSchema = z.object({
  origin: z.string().min(1),
  content: z.string().min(1),
});

export const EvalBankQuerySchema = z.object({
  query_text: z.string().min(1),
  command_id: z.number().int().positive(),
  kind: z.enum(['golden', 'extended', 'scrambled']).optional(),
});

export type SkillLevelText = z.infer<typeof SkillLevelTextSchema>;
export type IntentCategory = z.infer<typeof IntentCategorySchema>;
export type CommandRecipe = z.infer<typeof CommandRecipeSchema>;
export type CommandRow = z.infer<typeof CommandRowSchema>;
export type IntentRow = z.infer<typeof IntentRowSchema>;
export type GenerationLlmResponse = z.infer<typeof GenerationLlmResponseSchema>;
export type IntentExpansionItem = z.infer<typeof IntentExpansionItemSchema>;
export type IntentExpandSkip = z.infer<typeof IntentExpandSkipSchema>;
export type IntentExpandBatchLlmResponse = z.infer<typeof IntentExpandBatchLlmResponseSchema>;
export type IntentRewriteLlmResponse = z.infer<typeof IntentRewriteLlmResponseSchema>;
export type StrictJudge = z.infer<typeof StrictJudgeSchema>;
export type SemanticBlockChild = z.infer<typeof SemanticBlockChildSchema>;
export type SemanticBlock = z.infer<typeof SemanticBlockSchema>;
export type EvalBankQuery = z.infer<typeof EvalBankQuerySchema>;
