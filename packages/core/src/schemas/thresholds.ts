import { z } from 'zod';

/** Hybrid search thresholds (search algorithm v1). */
export const ThresholdsSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    topK: z.number().int().positive(),
    recallK: z.number().int().positive(),
    /** C > this → 1 result (exact). */
    confidenceVeryHigh: z.number(),
    /** C > this (and ≤ veryHigh) → 2 results + yellow. */
    confidenceHigh: z.number(),
    /** C > this (and ≤ high) → 3 results + orange; else 0 + red. */
    confidenceMedium: z.number(),
    normalizeQuery: z.boolean(),
  })
  .strict();

export type Thresholds = z.infer<typeof ThresholdsSchema>;
