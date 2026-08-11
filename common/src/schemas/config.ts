// @ts-nocheck
import { z } from 'zod';
import { SKILL_MAX, SKILL_MIN } from '../lib/skills.js';

export const UserConfigSchema = z.object({
  schemaVersion: z.number().int().positive().default(4),
  skillLevel: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .transform((v) => {
      if (v == null || v === undefined) return null;
      const n = Number(v);
      if (n === 5) return 4;
      if (Number.isInteger(n) && n >= SKILL_MIN && n <= SKILL_MAX) return n;
      return null;
    }),
  telemetry: z
    .union([z.boolean(), z.null()])
    .optional()
    .transform((v) => (v === true ? true : v === false ? false : null)),
  telemetryInvite: z
    .enum(['pending', 'dismissed'])
    .optional()
    .default('pending'),
  /** Opaque rotating session key for CLI search journeys (EVOLVE THREAD). */
  telemetrySessionId: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' && v.trim() ? v.trim() : null)),
  updateCheck: z
    .union([z.boolean(), z.null()])
    .optional()
    .transform((v) => (v === true ? true : v === false ? false : null)),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;
