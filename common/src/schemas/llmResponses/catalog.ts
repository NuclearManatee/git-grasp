// @ts-nocheck
import { z } from 'zod';
import { GlossarySchema } from '../glossary.js';

export const GlossaryLlmSchema = GlossarySchema.partial().passthrough();

export const CommandExampleSchema = z.object({
  example: z.string(),
  topic: z.string().optional(),
  source_hint: z.string().optional(),
}).passthrough();

export const CommandsExtractSchema = z.object({
  commands: z.array(z.object({
    command: z.string(),
    examples: z.array(CommandExampleSchema).optional().default([]),
  }).passthrough()).default([]),
}).passthrough();

export const CommandsAreYouSureSchema = z.object({
  sure: z.boolean(),
  missing_topics: z.array(z.string()).optional().default([]),
  additional_commands: z.array(z.object({
    command: z.string(),
    examples: z.array(CommandExampleSchema).optional().default([]),
  }).passthrough()).optional().default([]),
  rationale: z.string().optional().default(''),
}).passthrough();

export const ExampleFamiliesSchema = z.object({
  items: z.array(z.object({
    example: z.string(),
    intent_family: z.string().optional(),
    simplicity_rank: z.union([z.number(), z.string()]).optional(),
  }).passthrough()).default([]),
}).passthrough();

export const IntentBandSchema = z.object({
  skill_level: z.union([z.string(), z.number()]),
  intent_descriptions: z.array(z.string()).default([]),
}).passthrough();

export const IntentWriterSchema = z.object({
  command: z.string().optional(),
  example: z.string().optional(),
  explanation: z.string().optional(),
  usage: z.record(z.string(), z.unknown()).optional(),
  intents: z.array(IntentBandSchema).optional(),
  items: z.array(z.unknown()).optional(),
}).passthrough();

export const RecipeFamiliesSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    intent_family: z.string().optional(),
    simplicity_rank: z.union([z.number(), z.string()]).optional(),
  }).passthrough()).default([]),
}).passthrough();

export const RecipeIntentsSchema = z.object({
  intents: z.array(IntentBandSchema).default([]),
}).passthrough();

export const RecipeIntentAreYouSureSchema = z.object({
  sure: z.boolean(),
  additional_intents: z.array(IntentBandSchema).optional().default([]),
  rationale: z.string().optional().default(''),
}).passthrough();

export const RecipeDraftSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  topic: z.string().optional(),
  command: z.string().optional(),
  explanation: z.string().optional(),
  intent_family: z.string().optional(),
  checklist: z.string().optional(),
  commands: z.array(z.object({
    run: z.string(),
    comment: z.string().optional(),
  }).passthrough()).optional().default([]),
}).passthrough();

export const RecipeAreYouSureSchema = z.object({
  sure: z.boolean(),
  missing_topics: z.array(z.string()).optional().default([]),
  additional_recipes: z.array(RecipeDraftSchema).optional().default([]),
  rationale: z.string().optional().default(''),
}).passthrough();

export const WorkflowAreYouSureSchema = RecipeAreYouSureSchema;

export const WorkflowJudgeSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional().default(''),
}).passthrough();

/** Generic object for probe / unknown LLM JSON that still must be an object. */
export const LlmJsonObjectSchema = z.record(z.string(), z.unknown());
