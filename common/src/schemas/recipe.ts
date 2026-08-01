// @ts-nocheck
import { z } from 'zod';
import { checkExample, checkCommand, type ValidateOpts, type ValidateResult } from './gitCommand.js';
import { SkillLevelSchema } from './gitCommand.js';

export const RecipeCommandStepSchema = z.object({
  run: z.string().min(1),
  comment: z.string().optional().default(''),
});

export const RecipeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  commands: z.union([
    z.array(RecipeCommandStepSchema).min(1),
    z.string().transform((s, ctx) => {
      try {
        const parsed = JSON.parse(s);
        const r = z.array(RecipeCommandStepSchema).min(1).safeParse(parsed);
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
    const run = String(step?.run || '').trim();
    const ex = checkExample(run, opts);
    if (!ex.ok) return { ok: false, reason: ex.reason, run };
    if (typeof opts.validateFlags === 'function') {
      const flags = opts.validateFlags(run);
      if (!flags?.ok) return { ok: false, reason: flags?.reason || 'flags', run };
    }
  }
  const primary = r.primary_example || commands[0]!.run;
  const pe = checkExample(primary, opts);
  if (!pe.ok) return pe;
  if (r.command) {
    const cmd = checkCommand(r.command, opts);
    if (!cmd.ok && cmd.reason !== 'allowlist') return cmd;
  }
  return { ok: true };
}

export const RecipesFileSchema = z.array(RecipeSchema);

export { SkillLevelSchema };
