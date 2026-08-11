// @ts-nocheck
/**
 * Optional LLM confirm for ambiguous weak/abandon labels.
 */
import { z } from 'zod';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import { isAmbiguousLabel } from './label.js';

const LlmLabelSchema = z.object({
  label: z.enum(['satisfied', 'weak', 'miss', 'abandon']),
  reason: z.string(),
});

/**
 * @param {import('./schemas.js').Journey} journey
 * @param {{ llmJsonObject?: Function, enabled?: boolean }} [opts]
 */
export async function maybeLlmConfirmJourneyLabel(journey, opts = {}) {
  if (!opts.enabled) return journey;
  if (!isAmbiguousLabel(journey.finalLabel)) return journey;
  const call = opts.llmJsonObject || llmJsonObject;
  const final = journey.events[journey.events.length - 1];
  try {
    const { messages } = renderPrompt('evolve/confirm-label', {
      query: final.query,
      code_label: journey.finalLabel,
      journey: journey.events.map((e) => e.query).join(' → '),
      status: String(final.response?.status || ''),
      confidence: String(final.response?.confidence ?? ''),
      display_count: String(final.response?.displayCount ?? ''),
    });
    const out = await call({ schema: LlmLabelSchema, messages });
    if (out?.label) {
      return {
        ...journey,
        finalLabel: out.label,
        missLike: out.label === 'miss' || out.label === 'abandon' || out.label === 'weak',
        events: journey.events.map((e, i) =>
          i === journey.events.length - 1 ? { ...e, label: out.label } : e,
        ),
      };
    }
  } catch {
    /* keep code label */
  }
  return journey;
}

/**
 * @param {import('./schemas.js').Journey[]} journeys
 * @param {{ llmJsonObject?: Function, enabled?: boolean }} [opts]
 */
export async function maybeLlmConfirmLabels(journeys, opts = {}) {
  if (!opts.enabled) return journeys;
  const out = [];
  for (const j of journeys) {
    out.push(await maybeLlmConfirmJourneyLabel(j, opts));
  }
  return out;
}
