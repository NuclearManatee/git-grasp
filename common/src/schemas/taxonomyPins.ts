// @ts-nocheck
import { z } from 'zod';

/** Closed goal-role enum (infrastructure constraint, not catalog content). */
export const GOAL_ROLES = [
  'identity',
  'authorship',
  'history_search',
  'history_bisect',
  'staging',
  'branching',
  'remotes',
  'recovery',
  'inspection',
  'workspace',
  'dangerous',
  'niche',
] as const;

export type GoalRole = (typeof GOAL_ROLES)[number];

export const GoalRoleSchema = z.enum(GOAL_ROLES);

/** Roles that should receive at least one canonical pin in pass B. */
export const PIN_WORTHY_ROLES: ReadonlySet<GoalRole> = new Set([
  'identity',
  'authorship',
  'recovery',
  'history_search',
  'history_bisect',
  'remotes',
]);

export const RecipeSketchStepSchema = z.object({
  command: z.string().min(1),
  comment: z.string().optional().default(''),
});

export const RecipeSketchSchema = z.object({
  commands: z.array(RecipeSketchStepSchema).min(1).max(2),
});

export const CanonicalPinSchema = z.object({
  goal_id: z.string().min(1),
  verb: z.string().min(1),
  goal_roles: z.array(GoalRoleSchema).min(1),
  recipe_sketch: RecipeSketchSchema,
  /** Optional sandbox setup; derived heuristically when omitted. */
  initial_state: z.string().optional(),
  seed_intents: z.array(z.string().min(1)).min(3).max(5),
});

export const CanonicalPinsFileSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().min(1),
  pins: z.array(CanonicalPinSchema),
  dropped: z
    .array(
      z.object({
        goal_id: z.string().optional(),
        verb: z.string().optional(),
        reasons: z.array(z.string()),
      }),
    )
    .default([]),
});

/** Roles that must have â‰¥1 sandbox-ok pin after generation / ground. */
export const CRITICAL_PIN_ROLES: ReadonlySet<GoalRole> = new Set([
  'identity',
  'authorship',
  'history_bisect',
  'recovery',
]);

export const CommandRolesSchema = z.object({
  command: z.string().min(1),
  goal_roles: z.array(GoalRoleSchema).min(1),
});

export const TagRolesLlmResponseSchema = z.object({
  items: z.array(CommandRolesSchema).min(1),
});

/** Loose LLM envelope â€” structural validators gate what gets written. */
export const LlmPinDraftSchema = z.object({
  goal_id: z.string().min(1),
  verb: z.string().min(1),
  goal_roles: z.array(z.string()).min(1),
  recipe_sketch: z.preprocess((val) => {
    // Models sometimes return a single command string instead of { commands: [...] }.
    if (typeof val === 'string') {
      return { commands: [{ command: val, comment: '' }] };
    }
    if (Array.isArray(val)) {
      return {
        commands: val.map((c) =>
          typeof c === 'string' ? { command: c, comment: '' } : c,
        ),
      };
    }
    if (val && typeof val === 'object' && Array.isArray((val as { commands?: unknown }).commands)) {
      return val;
    }
    if (val && typeof val === 'object' && 'command' in (val as object)) {
      return { commands: [val] };
    }
    return val;
  }, z.object({
    commands: z
      .array(
        z.object({
          command: z.string().min(1),
          comment: z.string().optional(),
        }),
      )
      .min(1),
  })),
  seed_intents: z.array(z.string()).min(1),
  initial_state: z.string().optional(),
});

export const DraftPinsLlmResponseSchema = z.object({
  pins: z.array(LlmPinDraftSchema).max(40),
});

export const GapFillLlmResponseSchema = z.object({
  pins: z.array(LlmPinDraftSchema).max(40),
});

export const RepairPinsLlmResponseSchema = z.object({
  pins: z.array(LlmPinDraftSchema).max(40),
  dropped_goal_ids: z.array(z.string()).default([]),
});

export const RolesFileCommandSchema = z.object({
  name: z.string(),
  summary: z.string(),
  command: z.string(),
  section: z.string().optional(),
  goal_roles: z.array(GoalRoleSchema).min(1),
});

export const RolesFileSchema = z.object({
  version: z.literal(1),
  generated_at: z.string().min(1),
  source_taxonomy: z.string().optional(),
  commands: z.array(RolesFileCommandSchema).min(1),
});

export type CanonicalPin = z.infer<typeof CanonicalPinSchema>;
export type CanonicalPinsFile = z.infer<typeof CanonicalPinsFileSchema>;
export type RolesFile = z.infer<typeof RolesFileSchema>;
export type CommandRoles = z.infer<typeof CommandRolesSchema>;
