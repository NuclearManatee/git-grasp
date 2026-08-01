import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT } from '../lib/paths.js';
import { renderPrompt, renderPromptRole } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import {
  GenerationLlmResponseSchema,
  IntentExpansionLlmResponseSchema,
} from '../schemas/command.js';
import { parseCommands } from '../db/recipeFormat.js';
import { assertEvolveMutation } from './evolveGuards.js';
import { parseFlagsFromHelp } from './coverage.js';
import { fetchGitShortHelp } from './gitShortHelp.js';
import { filterIntentsForRecipe, primaryStepListing } from './intentFidelity.js';
import { INTENT_EXPAND_CAP } from '../db/constants.js';

function taxonomyPath(name) {
  const a = path.join(PACKAGE_ROOT, 'packages', 'core', 'taxonomy', name);
  if (existsSync(a)) return a;
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../taxonomy', name);
}

export function loadTaxonomy() {
  const skill = readFileSync(taxonomyPath('skill_level.md'), 'utf8');
  const category = readFileSync(taxonomyPath('intent_category.md'), 'utf8');
  return { skill, category };
}

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
 * @param {{ initial_state: string, command_recipe: object }} recipe
 * @param {{ llmJsonObject?: typeof llmJsonObject }} [opts]
 */
export async function expandIntentsForRecipe(recipe, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const { skill, category } = loadTaxonomy();
  const { primary, listing } = primaryStepListing(recipe);

  const { messages } = renderPrompt('build/expand-intents', {
    skill,
    category,
    primary,
    listing,
    initial_state: recipe.initial_state,
  });
  const result = await call({
    schema: IntentExpansionLlmResponseSchema,
    messages,
  });
  return filterIntentsForRecipe(recipe, result.intents, {
    cap: opts.cap ?? INTENT_EXPAND_CAP,
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
 * @deprecated Prefer evolveByKind — kept as State-mutation alias.
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
    allowlists: allowText || '(none — keep flags minimal)',
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
