// @ts-nocheck
import { renderPrompt, renderPromptRole } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import { GenerationLlmResponseSchema } from '../schemas/command.js';
import { parseCommands } from '../db/recipeFormat.js';
import { assertEvolveMutation } from './evolveGuards.js';
import { parseFlagsFromHelp } from './coverage.js';
import { fetchGitShortHelp } from './gitShortHelp.js';

export { expandIntentsForRecipe, loadTaxonomy } from './intentExpand.js';

/**
 * @param {{ command: string, blocks: { metadata_source: string, content: string }[] }} block
 */
export function semanticBlockToPrompt(block) {
  const chunkText = (block.blocks || [])
    .map((c) => `### ${c.metadata_source}\n${c.content}`)
    .join('\n\n');
  return `Command anchor: ${block.command}\n\n${chunkText}`;
}

/** Vanilla ground-pass system prompt (from markdown template). */
export const VANILLA_GENERATION_SYSTEM = renderPromptRole('build/vanilla', 'system');

/**
 * @param {object} block semantic block
 * @param {{ llmJsonObject?: typeof llmJsonObject, feedback?: string }} [opts]
 */
export async function generateRecipeFromSemanticBlock(block, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const feedback = opts.feedback
    ? `\nPrevious attempt failed:\n${opts.feedback}\nRegenerate a corrected initial_state and command_recipe.\n`
    : '';
  const { messages } = renderPrompt('build/vanilla', {
    block_text: semanticBlockToPrompt(block),
    feedback,
  });
  return call({
    schema: GenerationLlmResponseSchema,
    messages,
  });
}

/**
 * Evolution expansion — multi-axis mutations.
 */

function normalizeParentExamples(parent, examples) {
  const parentOut = {
    ...parent,
    command_recipe:
      typeof parent.command_recipe === 'string'
        ? JSON.parse(parent.command_recipe)
        : parent.command_recipe,
  };
  const examplesOut = (examples || []).map((ex) => ({
    ...ex,
    command_recipe:
      typeof ex?.command_recipe === 'string'
        ? JSON.parse(ex.command_recipe)
        : ex?.command_recipe,
  }));
  return { parentOut, examplesOut };
}

/**
 * @deprecated Prefer evolveByKind â€” kept as State-mutation alias.
 */
export async function evolveRecipe(parent, examples, opts = {}) {
  return evolveStateMutation(parent, examples, opts);
}

export async function evolveStateMutation(parent, examples, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { parentOut, examplesOut } = normalizeParentExamples(parent, examples);
  const { messages } = renderPrompt('build/evolve-state', {
    user_json: JSON.stringify({ parent: parentOut, examples: examplesOut }, null, 2),
  });
  const raw = await call({
    schema: GenerationLlmResponseSchema,
    messages,
  });
  if (opts.skipGuard) return { ...raw, mutation_kind: 'state' };
  const gate = assertEvolveMutation('state', parentOut, raw);
  if (!gate.ok) throw new Error(`evolve_state_guard:${gate.reason}`);
  return { ...raw, mutation_kind: 'state' };
}

export async function evolveFlagMutation(parent, examples, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { parentOut, examplesOut } = normalizeParentExamples(parent, examples);
  const allowlistsByVerb = opts.allowlistsByVerb || buildAllowlistsFromParent(parentOut);
  const allowText = Object.entries(allowlistsByVerb)
    .map(([v, set]) => `${v}: ${[...set].slice(0, 40).join(' ')}`)
    .join('\n');
  const { messages } = renderPrompt('build/evolve-flag', {
    allowlists: allowText || '(none â€” keep flags minimal)',
    user_json: JSON.stringify({ parent: parentOut, examples: examplesOut }, null, 2),
  });
  const raw = await call({
    schema: GenerationLlmResponseSchema,
    messages,
  });
  if (opts.skipGuard) return { ...raw, mutation_kind: 'flag' };
  const gate = assertEvolveMutation('flag', parentOut, raw, { allowlistsByVerb });
  if (!gate.ok) throw new Error(`evolve_flag_guard:${gate.reason}`);
  return { ...raw, mutation_kind: 'flag' };
}

export async function evolveCompositionMutation(parent, examples, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { parentOut, examplesOut } = normalizeParentExamples(parent, examples);
  const n = parseCommands(parentOut.command_recipe).length;
  const { messages } = renderPrompt('build/evolve-composition', {
    parent_steps: n,
    child_steps: n + 1,
    user_json: JSON.stringify(
      {
        parent: parentOut,
        examples: examplesOut,
        insert_index_hint: opts.insert_index,
      },
      null,
      2,
    ),
  });
  const raw = await call({
    schema: GenerationLlmResponseSchema,
    messages,
  });
  if (opts.skipGuard) return { ...raw, mutation_kind: 'composition' };
  const gate = assertEvolveMutation('composition', parentOut, raw, {
    insert_index: opts.insert_index,
    fetchHelp: opts.fetchHelp,
  });
  if (!gate.ok) throw new Error(`evolve_composition_guard:${gate.reason}`);
  return { ...raw, mutation_kind: 'composition' };
}

function buildAllowlistsFromParent(parent) {
  /** @type {Record<string, Set<string>>} */
  const out = {};
  for (const s of parseCommands(parent.command_recipe)) {
    const parts = s.command.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const verb = `git ${parts[1]}`;
    if (out[verb]) continue;
    const help = fetchGitShortHelp(verb);
    out[verb] = parseFlagsFromHelp(help.text || '');
  }
  return out;
}

/**
 * @param {'state'|'flag'|'composition'} kind
 */
export async function evolveByKind(kind, parent, examples, opts = {}) {
  if (kind === 'flag') return evolveFlagMutation(parent, examples, opts);
  if (kind === 'composition') return evolveCompositionMutation(parent, examples, opts);
  return evolveStateMutation(parent, examples, opts);
}
