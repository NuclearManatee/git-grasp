// @ts-nocheck
import { z } from 'zod';

export const SEARCH_EVENT_NAMES = new Set(['cli_search', 'web_cli_search']);

export const OutcomeLabelSchema = z.enum(['satisfied', 'weak', 'miss', 'abandon']);

export const RawUmamiEventSchema = z.object({
  id: z.string().optional(),
  eventId: z.string().optional(),
  name: z.string(),
  createdAt: z.union([z.string(), z.number()]).optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  sessionId: z.string().nullable().optional(),
  visitId: z.string().nullable().optional(),
  visitorId: z.string().nullable().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  eventData: z.record(z.string(), z.unknown()).optional(),
});

export const FilteredSearchEventSchema = z.object({
  id: z.string(),
  name: z.enum(['cli_search', 'web_cli_search']),
  createdAtMs: z.number().int().nonnegative(),
  threadKey: z.string(),
  session_id: z.string().nullable().optional(),
  query: z.string().min(1),
  catalog_version: z.union([z.number(), z.string()]).nullable().optional(),
  schema_version: z.union([z.number(), z.string()]).nullable().optional(),
  mock: z.boolean().optional(),
  response: z.record(z.string(), z.unknown()).optional(),
  latency_ms: z.number().optional(),
  source: z.string().optional(),
  label: OutcomeLabelSchema.optional(),
});

export const JourneySchema = z.object({
  threadKey: z.string(),
  catalog_version: z.union([z.number(), z.string()]).nullable().optional(),
  events: z.array(FilteredSearchEventSchema).min(1),
  finalLabel: OutcomeLabelSchema,
  missLike: z.boolean(),
});

export const FeederItemSchema = z.object({
  query: z.string().min(1),
  displayedIds: z.array(z.string()).default([]),
  confidence: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  journey: z.array(z.string()).default([]),
  source: z.literal('observe'),
  catalog_version: z.union([z.number(), z.string()]).nullable().optional(),
  eventIds: z.array(z.string()).default([]),
  threadKey: z.string().optional(),
  finalLabel: OutcomeLabelSchema,
  expectedId: z.string().optional(),
  leafId: z.string().optional(),
  leafIds: z.array(z.string()).optional(),
  hit: z.boolean().optional(),
  correctExists: z.boolean().optional(),
});

export const EvolveCursorSchema = z.object({
  last_pulled_at: z.string().nullable().optional(),
  last_event_id: z.string().nullable().optional(),
  updated_at: z.string().optional(),
});

export const EvolveStatsSchema = z.object({
  at: z.string(),
  catalog_version_in: z.union([z.number(), z.string(), z.null()]).optional(),
  catalog_version_out: z.union([z.number(), z.string(), z.null()]).optional(),
  pulled: z.number().int().nonnegative(),
  filtered_kept: z.number().int().nonnegative(),
  filtered_dropped: z.number().int().nonnegative(),
  drop_reasons: z.record(z.string(), z.number()).default({}),
  threads: z.number().int().nonnegative(),
  feeder_train: z.number().int().nonnegative(),
  feeder_holdout: z.number().int().nonnegative(),
  chain: z
    .object({
      ran: z.boolean(),
      ok: z.boolean().optional(),
      triaged: z.number().int().nonnegative().optional(),
      observe_holdout_hit_rate: z.number().nullable().optional(),
      corpus_version: z.union([z.number(), z.string(), z.null()]).optional(),
      shipped: z.boolean().optional(),
      error: z.string().optional(),
      ship_gates: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export type FilteredSearchEvent = z.infer<typeof FilteredSearchEventSchema>;
export type Journey = z.infer<typeof JourneySchema>;
export type FeederItem = z.infer<typeof FeederItemSchema>;
export type EvolveCursor = z.infer<typeof EvolveCursorSchema>;
export type EvolveStats = z.infer<typeof EvolveStatsSchema>;
