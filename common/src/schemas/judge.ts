// @ts-nocheck
import { z } from 'zod';

export const JudgeResultSchema = z.object({
  score: z.union([z.number(), z.string()]).transform((v) => Number(v) || 1),
  pass: z.union([z.boolean(), z.string(), z.number()]).transform((v) => Boolean(v)),
  passAt3: z.union([z.boolean(), z.string(), z.number()]).optional(),
  passAt5: z.union([z.boolean(), z.string(), z.number()]).optional(),
  rationale: z.string().optional().default(''),
}).transform((o) => ({
  score: o.score,
  pass: o.pass,
  passAt3: o.passAt3 != null ? Boolean(o.passAt3) : o.pass || o.score >= 3,
  passAt5: o.passAt5 != null ? Boolean(o.passAt5) : o.pass && o.score >= 5,
  rationale: o.rationale || '',
}));

export type JudgeResult = z.infer<typeof JudgeResultSchema>;
