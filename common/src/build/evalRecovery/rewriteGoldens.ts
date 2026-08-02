// @ts-nocheck
/**
 * Pro rewrite-context + Flash golden rewrite for eval recovery.
 */
import { llmJsonObject } from '../../lib/llm.js';
import { DEEPSEEK_PRO_MODEL, DEEPSEEK_FLASH_MODEL } from '../../lib/providers.js';
import { renderPrompt } from '../../lib/prompts.js';
import {
  RewriteEvalContextBatchSchema,
  RewriteEvalGoldenBatchSchema,
} from '../../schemas/evalRecovery.js';

function verbToken(primaryVerb) {
  return String(primaryVerb || '')
    .replace(/^git\s+/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Validate Flash actions against primary verb fidelity.
 */
export function filterValidGoldenActions(actions, missByCommandId) {
  const out = [];
  const errors = [];
  for (const a of actions || []) {
    const id = Number(a.command_id);
    const miss = missByCommandId.get(id);
    if (!miss) {
      errors.push(`unknown command_id ${id}`);
      continue;
    }
    if (a.op === 'drop') {
      out.push({ command_id: id, op: 'drop' });
      continue;
    }
    if (a.op !== 'rewrite' || !a.query_text) {
      errors.push(`invalid rewrite for ${id}`);
      continue;
    }
    const text = String(a.query_text).trim();
    const token = verbToken(miss.primary_verb);
    if (token && !new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) {
      errors.push(`rewrite ${id}: missing primary verb token ${token}`);
      continue;
    }
    const reason = miss.row?.reason || miss.row?.judge?.reason || '';
    if (reason && text.toLowerCase().includes(String(reason).toLowerCase().slice(0, 40))) {
      errors.push(`rewrite ${id}: copies judge reason`);
      continue;
    }
    out.push({ command_id: id, op: 'rewrite', query_text: text });
  }
  return { actions: out, errors };
}

export async function proposeRewriteContext(classifiedBankMisses, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const misses = (classifiedBankMisses || []).map((c) => ({
    command_id: c.command_id,
    query_text: c.query_text,
    class: c.class,
    primary_verb: c.primary_verb,
    displayed: (c.row?.displayed || []).map((h) => ({
      example: h.example,
      snippet: h.snippet,
    })),
    utility: c.row?.utility ?? c.row?.judge?.utility ?? null,
  }));
  const { messages } = renderPrompt('build/rewrite-eval-context', {
    misses_json: JSON.stringify(misses, null, 2),
  });
  return call({
    schema: RewriteEvalContextBatchSchema,
    messages,
    model: opts.proModel || DEEPSEEK_PRO_MODEL,
  });
}

export async function proposeGoldenRewrites(classifiedBankMisses, contextBatch, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const mode = opts.mode || 'fail';
  const misses = (classifiedBankMisses || []).map((c) => ({
    command_id: c.command_id,
    query_text: c.query_text,
    class: c.class,
    primary_verb: c.primary_verb,
  }));
  const { messages } = renderPrompt('build/rewrite-eval-golden', {
    mode,
    context_json: JSON.stringify(contextBatch || { items: [] }, null, 2),
    misses_json: JSON.stringify(misses, null, 2),
  });
  const raw = await call({
    schema: RewriteEvalGoldenBatchSchema,
    messages,
    model: opts.flashModel || DEEPSEEK_FLASH_MODEL,
  });
  const missByCommandId = new Map(
    (classifiedBankMisses || []).map((c) => [Number(c.command_id), c]),
  );
  return filterValidGoldenActions(raw.actions || [], missByCommandId);
}
