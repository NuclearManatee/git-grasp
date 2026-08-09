// @ts-nocheck
import { z } from 'zod';

export const GoalTaxonomyNodeSchema: z.ZodTypeAny = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    depth: z.number().int().nonnegative(),
    parent_id: z.string().nullable().optional(),
    children: z.array(GoalTaxonomyNodeSchema).optional().default([]),
    mapped_commands: z.array(z.string()).optional().default([]),
    is_leaf: z.boolean().optional(),
  }),
);

export const GoalTaxonomyLeafSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  depth: z.number().int().nonnegative(),
  parent_id: z.string().nullable().optional(),
  mapped_commands: z.array(z.string()).min(1),
  path: z.array(z.string()).optional().default([]),
});

export const GoalTaxonomyCoverageSchema = z.object({
  commands_total: z.number().int().nonnegative(),
  commands_mapped: z.number().int().nonnegative(),
  commands_unmapped: z.array(z.string()),
  empty_leaves: z.array(z.string()),
  duplicate_leaf_ids: z.array(z.string()),
});

export const GoalTaxonomyFileSchema = z.object({
  version: z.literal(1),
  created_at: z.string().min(1),
  max_depth: z.number().int().positive(),
  max_fanout: z.number().int().positive(),
  reflection_rounds: z.number().int().nonnegative(),
  cover_rounds: z.number().int().nonnegative().optional(),
  roots: z.array(GoalTaxonomyNodeSchema).min(1),
  leaves: z.array(GoalTaxonomyLeafSchema),
  coverage: GoalTaxonomyCoverageSchema,
});

export const BrainstormGoalsLlmSchema = z.object({
  categories: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .min(1),
});

export const DecomposeNodeLlmSchema = z.object({
  children: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        stop: z.boolean().optional().default(false),
      }),
    )
    .max(32),
  stop: z.boolean().optional().default(false),
});

export const MapLeafCommandsLlmSchema = z.object({
  commands: z.array(z.string()).default([]),
  discard: z.boolean().optional().default(false),
  reason: z.string().optional(),
});

export const ReflectTaxonomyLlmSchema = z.object({
  rename: z
    .array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() }))
    .optional()
    .default([]),
  merge: z
    .array(z.object({ keep_id: z.string(), drop_ids: z.array(z.string()).min(1) }))
    .optional()
    .default([]),
  notes: z.array(z.string()).optional().default([]),
});

export const CoverUnmappedLlmSchema = z.object({
  assign: z
    .array(z.object({ command: z.string().min(1), leaf_id: z.string().min(1) }))
    .optional()
    .default([]),
  new_leaves: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        description: z.string().min(1),
        commands: z.array(z.string()).min(1),
      }),
    )
    .optional()
    .default([]),
});

export type GoalTaxonomyNode = z.infer<typeof GoalTaxonomyNodeSchema>;
export type GoalTaxonomyLeaf = z.infer<typeof GoalTaxonomyLeafSchema>;
export type GoalTaxonomyFile = z.infer<typeof GoalTaxonomyFileSchema>;
export type GoalTaxonomyCoverage = z.infer<typeof GoalTaxonomyCoverageSchema>;
