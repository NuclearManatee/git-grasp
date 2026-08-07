// @ts-nocheck
import { z } from 'zod';

/** Hybrid search thresholds (search algorithm v1). */
export const ThresholdsSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    topK: z.number().int().positive(),
    recallK: z.number().int().positive(),
    /** C > this â†’ 1 result (exact). */
    confidenceVeryHigh: z.number(),
    /** C > this (and â‰¤ veryHigh) â†’ 2 results + yellow. */
    confidenceHigh: z.number(),
    /** C > this (and ≤ high) → candidate for 3 results + orange (red only via absolute evidence). */
    confidenceMedium: z.number(),
    normalizeQuery: z.boolean(),
    /** Min S1−S2 gap for the 1-result "exact" band (default DISPLAY_GAP_EXACT). */
    gapExact: z.number().optional(),
    /** Min S1−S2 gap for the 2-result band (default DISPLAY_GAP_NARROW). */
    gapNarrow: z.number().optional(),
    /** Abstain floor on top raw cosine (default DISPLAY_ABSTAIN_COSINE_FLOOR). */
    abstainCosineFloor: z.number().optional(),
  })
  .strict();

export type Thresholds = z.infer<typeof ThresholdsSchema>;
