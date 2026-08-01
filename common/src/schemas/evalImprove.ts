// @ts-nocheck
import { z } from 'zod';

export const LexiconTrapSchema = z.object({
  role: z.string().min(1).max(120),
  needles: z.array(z.string().min(1)).min(1).max(16),
  prefer_verb: z.string().min(1),
  source: z.enum(['seed', 'eval_round']).default('eval_round'),
  evidence_command_ids: z.array(z.number().int().positive()).max(32).optional(),
});

export const LexiconTrapsFileSchema = z.object({
  version: z.number().int().positive().default(1),
  traps: z.array(LexiconTrapSchema).max(200),
});

export const VerbFamilySchema = z.object({
  canonical: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1).max(8),
  source: z.enum(['seed', 'eval_round']).default('eval_round'),
  evidence_command_ids: z.array(z.number().int().positive()).max(32).optional(),
});

export const VerbFamiliesFileSchema = z.object({
  version: z.number().int().positive().default(1),
  families: z.array(VerbFamilySchema).max(100),
});

export const FlagDenylistFileSchema = z.object({
  version: z.number().int().positive().default(1),
  flags: z.array(z.string().min(1)).max(100),
});

export const LexiconTrapProposalSchema = z.object({
  kind: z.literal('lexicon_trap'),
  role: z.string().min(1).max(120),
  needles: z.array(z.string().min(1)).min(1).max(8),
  prefer_verb: z.string().min(1),
  /** Prefer ≥2 train-miss ids; validators may accept 1 id when ≥2 queries match. */
  evidence_command_ids: z.array(z.number().int().positive()).min(1).max(16),
});

export const VerbFamilyProposalSchema = z.object({
  kind: z.literal('verb_family'),
  canonical: z.string().min(1),
  aliases: z.array(z.string().min(1)).min(1).max(4),
  evidence_command_ids: z.array(z.number().int().positive()).min(1).max(16),
});

export const EvalImproveProposalSchema = z.discriminatedUnion('kind', [
  LexiconTrapProposalSchema,
  VerbFamilyProposalSchema,
]);

export const EvalImproveProposalBatchSchema = z.object({
  proposals: z.array(EvalImproveProposalSchema).max(8),
});

export const EvalFailureClusterSchema = z.object({
  clusters: z
    .array(
      z.object({
        label: z.string().min(1).max(200),
        pattern: z.string().min(1).max(500),
        example_queries: z.array(z.string()).max(6),
        command_ids: z.array(z.number().int().positive()).max(32),
      }),
    )
    .max(20),
});

export const EVAL_IMPROVE_MAX_TRAPS_PER_ROUND = 5;
export const EVAL_IMPROVE_MAX_FAMILIES_PER_ROUND = 3;
export const EVAL_IMPROVE_POLISH_MISS_MIN = 5;
export const EVAL_IMPROVE_POLISH_PASS_A = 0.95;
