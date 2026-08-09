// @ts-nocheck
/**
 * Product recipe schema (v9) — NL description + templated commands.
 * Legacy RecipeSchema (run steps) kept for gradual migration of older fixtures.
 */
import { z } from 'zod';
import { checkExample, checkCommand, type ValidateOpts, type ValidateResult } from './gitCommand.js';
import { SkillLevelSchema } from './gitCommand.js';

/** Closed sandbox fixture vocabulary (B+C) — keep in sync with sandboxFixtures.ts. */
export const SANDBOX_FIXTURES = [
  'bare_workdir',
  'inited',
  'with_commit',
  'with_tracked_file',
  'dirty_worktree',
  'staged_changes',
  'with_history',
  'two_branches',
  'with_remote',
] as const;

export const SandboxFixtureSchema = z.enum(SANDBOX_FIXTURES);

export const RecipeProvenanceSchema = z.enum([
  'synthetic',
  'real-failure-seeded',
  'gap-filled',
]);

export const ProductRecipeStepSchema = z.object({
  command: z.string().min(1),
  comment: z.string().optional().default(''),
});

/** Coerce LLM numeric fields that often arrive as strings. */
const RiskSchema = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}, z.number().min(0).max(1)).default(0);

const Score01Schema = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}, z.number().min(0).max(1));

export const ProductRecipeSchema = z.object({
  id: z.string().min(1),
  commands: z.array(ProductRecipeStepSchema).min(1),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  tags: z.array(z.string()).default([]),
  taxonomy_leaf: z.string().min(1),
  paraphrases: z.array(z.string()).default([]),
  provenance: RecipeProvenanceSchema.default('synthetic'),
  validated: z.boolean().default(false),
  /** Structured sandbox fixture id; initial_state stores fixture:<id> label. */
  fixture: SandboxFixtureSchema.optional(),
  initial_state: z.string().default(''),
  command_fingerprint: z.string().optional(),
  initial_state_physical_hash: z.string().optional(),
  final_state_physical_hash: z.string().optional(),
  risk: RiskSchema,
});

export type ProductRecipe = z.infer<typeof ProductRecipeSchema>;
export type RecipeProvenance = z.infer<typeof RecipeProvenanceSchema>;

/** LLM generate response for a leaf candidate (before id / sandbox hashes). */
export const LeafRecipeLlmSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(4000),
  tags: z.array(z.string()).default([]),
  commands: z.array(ProductRecipeStepSchema).min(1),
  fixture: SandboxFixtureSchema.optional(),
  risk: RiskSchema,
  paraphrases: z.array(z.string()).optional().default([]),
});

export const PlausibilityLlmSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
});

export const MeaningfulnessJudgeLlmSchema = z.object({
  score: Score01Schema,
  pass: z.boolean(),
  reason: z.string().optional(),
});

export const BackTranslateLlmSchema = z.object({
  reconstructed_intent: z.string().min(1),
  aligned: z.boolean(),
  similarity: Score01Schema.optional(),
  reason: z.string().optional(),
});

// --- Legacy search-oriented recipe (run steps) ---

export const RecipeCommandStepSchema = z.object({
  run: z.string().min(1),
  comment: z.string().optional().default(''),
});

export const RecipeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  commands: z.union([
    z.array(RecipeCommandStepSchema).min(1),
    z.array(ProductRecipeStepSchema).min(1),
    z.string().transform((s, ctx) => {
      try {
        const parsed = JSON.parse(s);
        const r = z
          .array(z.union([RecipeCommandStepSchema, ProductRecipeStepSchema]))
          .min(1)
          .safeParse(parsed);
        if (!r.success) {
          ctx.addIssue({ code: 'custom', message: 'commands_json' });
          return z.NEVER;
        }
        return r.data;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'commands_json' });
        return z.NEVER;
      }
    }),
  ]),
  primary_example: z.string().optional(),
  command: z.string().optional(),
  explanation: z.string().optional(),
  topic: z.string().optional(),
  intent_family: z.string().optional(),
  simplicity_rank: z.number().optional(),
  source: z.string().optional(),
  checklist: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  taxonomy_leaf: z.string().optional(),
  paraphrases: z.array(z.string()).optional(),
  provenance: RecipeProvenanceSchema.optional(),
  validated: z.boolean().optional(),
}).passthrough();

export type Recipe = z.infer<typeof RecipeSchema>;

export type RecipeValidateOpts = ValidateOpts & {
  validateFlags?: (run: string) => { ok: boolean; reason?: string };
};

export function validateRecipeWithZod(
  recipe: unknown,
  opts: RecipeValidateOpts = {},
): ValidateResult {
  const parsed = RecipeSchema.safeParse(recipe);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || 'schema';
    if (msg === 'commands_json') return { ok: false, reason: 'commands_json' };
    return { ok: false, reason: 'schema' };
  }
  const r = parsed.data;
  const commands = r.commands;
  if (!Array.isArray(commands) || commands.length === 0) {
    return { ok: false, reason: 'commands_empty' };
  }
  for (const step of commands) {
    const run = String(step?.command ?? step?.run ?? '').trim();
    const ex = checkExample(run, opts);
    if (!ex.ok) return { ok: false, reason: ex.reason, run };
    if (typeof opts.validateFlags === 'function') {
      const flags = opts.validateFlags(run);
      if (!flags?.ok) return { ok: false, reason: flags?.reason || 'flags', run };
    }
  }
  const primary =
    r.primary_example ||
    String(commands[0]!.command ?? commands[0]!.run ?? '');
  const pe = checkExample(primary, opts);
  if (!pe.ok) return pe;
  if (r.command) {
    const cmd = checkCommand(r.command, opts);
    if (!cmd.ok && cmd.reason !== 'allowlist') return cmd;
  }
  return { ok: true };
}

export const RecipesFileSchema = z.array(RecipeSchema);
export const ProductRecipesFileSchema = z.array(ProductRecipeSchema);

export { SkillLevelSchema };
