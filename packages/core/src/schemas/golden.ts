import { z } from 'zod';
import { coerceSkillBandValue } from '../lib/skills.js';

function normalizeSkillBand(band: unknown): number[] {
  if (!Array.isArray(band) || band.length === 0) return [1, 4];
  return band.map((v) => {
    try {
      return coerceSkillBandValue(v);
    } catch {
      const n = Number(v);
      if (n === 5) return 4;
      return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 2;
    }
  });
}

/** Raw golden case as stored on disk (heterogeneous / legacy fields allowed). */
export const GoldenCaseRawSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  expectedCommand: z.string().optional(),
  expectedExample: z.string().optional(),
  expectedSimplestExample: z.string().optional(),
  acceptableCommands: z.array(z.string()).optional(),
  acceptableExamples: z.array(z.string()).optional(),
  expectedRecipeId: z.string().optional(),
  acceptableRecipeIds: z.array(z.string()).optional(),
  expectedSkillBand: z.array(z.union([z.number(), z.string()])).optional(),
  preferSimplest: z.boolean().optional(),
  judgeNotes: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).passthrough();

export type GoldenCaseRaw = z.infer<typeof GoldenCaseRawSchema>;

export type GoldenCase = GoldenCaseRaw & {
  expectedCommand?: string;
  expectedExample: string;
  acceptableCommands: string[];
  acceptableExamples: string[];
  expectedSimplestExample: string;
  preferSimplest: boolean;
  expectedSkillBand: number[];
};

export const GoldenCasesFileSchema = z.array(GoldenCaseRawSchema);

/**
 * Apply glossary-aware migration. Callers supply normalize helpers to avoid circular imports.
 */
export function migrateGoldenCaseWith(
  c: GoldenCaseRaw,
  normalizeGoldenText: (text: string) => string,
): GoldenCase {
  const expectedCommand = c.expectedCommand
    ? normalizeGoldenText(c.expectedCommand).split(/\s+/).slice(0, 2).join(' ')
    : '';
  const expectedExample = normalizeGoldenText(
    c.expectedExample || c.expectedCommand || '',
  );
  const acceptableExamples = [
    ...(c.acceptableExamples || []),
    ...(c.acceptableCommands || []),
  ].map((x) => normalizeGoldenText(x));
  const preferSimplest = c.preferSimplest !== false;
  return {
    ...c,
    expectedCommand: c.expectedCommand?.includes('<')
      ? expectedCommand
      : (c.expectedCommand?.split(/\s+/).length && c.expectedCommand.split(/\s+/).length > 2
        ? c.expectedCommand.split(/\s+/).slice(0, 2).join(' ')
        : c.expectedCommand),
    expectedExample,
    acceptableCommands: (c.acceptableCommands || [c.expectedCommand || '']).filter(Boolean).map((x) => {
      const n = normalizeGoldenText(x);
      return n.split(/\s+/).slice(0, 2).join(' ');
    }),
    acceptableExamples: [...new Set(acceptableExamples.filter(Boolean))],
    expectedSimplestExample: normalizeGoldenText(
      c.expectedSimplestExample || expectedExample,
    ),
    preferSimplest,
    expectedSkillBand: normalizeSkillBand(c.expectedSkillBand),
  };
}

export { normalizeSkillBand };
