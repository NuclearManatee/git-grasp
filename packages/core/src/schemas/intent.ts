import { z } from 'zod';
import { SkillLevelSchema, checkCommand, checkExample, type ValidateOpts, type ValidateResult } from './gitCommand.js';

export const SearchIntentSchema = z.object({
  id: z.string().min(1),
  recipe_id: z.string().min(1),
  intent_text: z.string().min(1).max(2000).optional(),
  intent_description: z.string().min(1).max(2000).optional(),
  skill_level: SkillLevelSchema,
}).passthrough().superRefine((val, ctx) => {
  const text = val.intent_text || val.intent_description;
  if (!text) {
    ctx.addIssue({ code: 'custom', message: 'schema', path: ['intent_text'] });
  }
});

export type SearchIntent = z.infer<typeof SearchIntentSchema>;

export type SearchIntentValidateOpts = {
  recipeIds?: Set<string>;
};

export function validateSearchIntentWithZod(
  intent: unknown,
  opts: SearchIntentValidateOpts = {},
): ValidateResult {
  const parsed = SearchIntentSchema.safeParse(intent);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    if (msg === 'Too big' || parsed.error.issues.some((i) => i.code === 'too_big')) {
      return { ok: false, reason: 'length' };
    }
    return { ok: false, reason: 'schema' };
  }
  const row = parsed.data;
  if (opts.recipeIds && !opts.recipeIds.has(row.recipe_id)) {
    return { ok: false, reason: 'fk' };
  }
  return { ok: true };
}

export function validateIntentRowWithZod(
  row: any,
  opts: ValidateOpts = {},
): ValidateResult {
  const cmd = checkCommand(row?.command, opts);
  if (!cmd.ok) return cmd;
  const example = row.example != null ? row.example : row.command;
  const ex = checkExample(example, opts);
  if (!ex.ok) return ex;
  const text = row.intent_description || row.intent_text;
  if (!text || typeof text !== 'string') {
    return { ok: false, reason: 'schema' };
  }
  if (text.length > 2000) return { ok: false, reason: 'length' };
  const skill = SkillLevelSchema.safeParse(row.skill_level);
  if (!skill.success) return { ok: false, reason: 'schema' };
  return { ok: true };
}

export const IntentJsonlLineSchema = z.object({
  id: z.string().min(1),
  recipe_id: z.string().min(1),
  intent_text: z.string().optional(),
  intent_description: z.string().optional(),
  skill_level: z.union([z.number(), z.string()]).transform((v) => {
    const n = Number(v) === 5 ? 4 : Number(v);
    return n;
  }),
}).passthrough();
