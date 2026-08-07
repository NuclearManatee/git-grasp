// @ts-nocheck
/**
 * Generate missing composite recipes for coverage_gap misses (additive only).
 */
import { z } from 'zod';
import {
  openDb,
  listCommands,
  getCommand,
  insertCommand,
  insertCommandEmbedding,
  deleteCommandCascade,
  insertIntentWithEmbedding,
} from '../../db/schema.js';
import { primaryCommand, parseCommands } from '../../db/recipeFormat.js';
import { EVAL_COVERAGE_MAX_INSERTS } from '../../db/constants.js';
import { llmJsonObject } from '../../lib/llm.js';
import { renderPrompt } from '../../lib/prompts.js';
import { evolveCompositionMutation } from '../generate.js';
import { expandIntentsForRecipe } from '../intentExpand.js';
import { generateAndValidate } from '../validate.js';
import { polishRecipeHygiene } from '../polishRecipe.js';
import { verbFromCommandLine } from '../coverage.js';
import {
  queryGitVerbs,
  recipeVerbSet,
  recipeCoversVerbs,
} from './coverageHelpers.js';

function commandEmbedText(row) {
  const steps = parseCommands(row.command_recipe);
  return `${row.initial_state}\n${steps.map((s) => s.command).join('\n')}`;
}

function normVerb(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const GoalToVerbsSchema = z.object({
  verbs: z.array(z.string()).min(1).max(6),
});

/**
 * Normalize a verb string to `git <name>` form when possible.
 * @param {string} v
 */
export function normalizeGoalVerb(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  if (s.startsWith('git ')) return verbFromCommandLine(s) || normVerb(s);
  return verbFromCommandLine(`git ${s}`) || `git ${s.replace(/^git\s+/, '')}`;
}

/**
 * Filter LLM-proposed verbs against known taxonomy verbs.
 * @param {string[]} proposed
 * @param {string[]} [knownVerbs] taxonomy verbs like `git status`
 */
export function filterKnownVerbs(proposed, knownVerbs = []) {
  const known = new Set((knownVerbs || []).map(normVerb));
  const out = [];
  for (const p of proposed || []) {
    const n = normalizeGoalVerb(p);
    if (!n) continue;
    if (known.size) {
      const bare = n.replace(/^git\s+/, '');
      const ok = [...known].some((k) => k === n || k.replace(/^git\s+/, '') === bare);
      if (!ok) continue;
    }
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * LLM: translate a goal-shaped query into target verbs.
 * @param {string} queryText
 * @param {{
 *   llmJsonObject?: Function,
 *   primaryVerb?: string|null,
 *   initialState?: string,
 *   knownVerbs?: string[],
 * }} [opts]
 */
export async function goalToVerbs(queryText, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const known = opts.knownVerbs || [];
  const { messages } = renderPrompt('build/goal-to-verbs', {
    query_text: queryText,
    primary_verb: opts.primaryVerb || '',
    initial_state: opts.initialState || '(none)',
    known_verbs: known.length ? known.join('\n') : '(none)',
  });
  const out = await call({
    schema: GoalToVerbsSchema,
    messages,
  });
  return filterKnownVerbs(out?.verbs || [], known);
}

/**
 * Pick a parent that already contains one of the needed verbs (prefer primary).
 * @param {object[]} commands
 * @param {string[]} needed
 * @param {string|null} primaryVerb
 */
export function pickCoverageParent(commands, needed, primaryVerb) {
  const neededSet = new Set((needed || []).map(normVerb));
  const prefer = normVerb(primaryVerb);
  let best = null;
  let bestScore = -1;
  for (const c of commands || []) {
    const verbs = recipeVerbSet(c.command_recipe);
    const overlap = [...verbs].filter((v) => neededSet.has(v)).length;
    if (overlap < 1) continue;
    if (recipeCoversVerbs(verbs, needed)) continue;
    const steps = parseCommands(c.command_recipe).length;
    if (steps >= 7) continue;
    let score = overlap * 10 - steps;
    if (prefer && verbs.has(prefer)) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function stagingAlreadyCovers(commands, needed) {
  return (commands || []).some((c) =>
    recipeCoversVerbs(recipeVerbSet(c.command_recipe), needed),
  );
}

/**
 * Resolve target verbs for a coverage miss: query text first, else goal-to-verbs.
 * @returns {Promise<{ needed: string[], verbSource: string, reason?: string, error?: string }>}
 */
export async function resolveCoverageVerbs(miss, opts = {}) {
  const queryText = miss.query_text || miss.row?.query?.query_text || '';
  const primaryVerb =
    miss.primary_verb || miss.row?.query?.primary_verb || null;
  const fromQuery = queryGitVerbs(queryText);
  if (fromQuery.length >= 2) {
    return { needed: fromQuery, verbSource: 'query' };
  }
  try {
    const fromGoal = await goalToVerbs(queryText, {
      llmJsonObject: opts.llmJsonObject,
      primaryVerb,
      initialState: miss.row?.query?.initial_state || miss.initial_state || '',
      knownVerbs: opts.knownVerbs || opts.taxonomyVerbs || [],
    });
    if (fromGoal.length >= 2) {
      return { needed: fromGoal, verbSource: 'goal_to_verbs' };
    }
    return {
      needed: fromGoal,
      verbSource: 'goal_to_verbs',
      reason: 'need_two_verbs',
    };
  } catch (e) {
    return {
      needed: fromQuery,
      verbSource: 'goal_to_verbs',
      reason: 'goal_to_verbs_error',
      error: String(e?.message || e),
    };
  }
}

/**
 * @param {object[]} coverageGapMisses classified miss entries
 * @param {{
 *   stagingPath: string,
 *   db?: object,
 *   embedder: { embed: Function },
 *   llmJsonObject?: Function,
 *   expandIntents?: Function,
 *   validate?: Function,
 *   log?: (m: string) => void,
 *   maxInserts?: number,
 *   taxonomyVerbs?: string[],
 *   knownVerbs?: string[],
 * }} opts
 * @returns {Promise<{ insertedIds: number[], attempts: object[], birthQueries: object[] }>}
 */
export async function generateCoverageGapComposites(coverageGapMisses, opts) {
  const log = opts.log || (() => {});
  const maxInserts = opts.maxInserts ?? EVAL_COVERAGE_MAX_INSERTS;
  const ownsDb = !opts.db;
  const db = opts.db || openDb(opts.stagingPath);
  /** @type {number[]} */
  const insertedIds = [];
  /** @type {object[]} */
  const attempts = [];
  /** @type {{ row_id: number, query_text: string, primary_verb: string|null, gap_command_id: number|null }[]} */
  const birthQueries = [];

  try {
    const seenKeys = new Set();
    for (const miss of coverageGapMisses || []) {
      if (insertedIds.length >= maxInserts) break;
      const queryText = miss.query_text || miss.row?.query?.query_text || '';
      const primaryVerb =
        miss.primary_verb || miss.row?.query?.primary_verb || null;

      const resolved = await resolveCoverageVerbs(miss, opts);
      const needed = resolved.needed || [];
      if (needed.length < 2) {
        attempts.push({
          command_id: miss.command_id,
          reason: resolved.reason || 'need_two_verbs',
          needed,
          verbSource: resolved.verbSource,
          ...(resolved.error ? { error: resolved.error } : {}),
        });
        continue;
      }
      const key = needed.slice().sort().join('|');
      if (seenKeys.has(key)) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'dup_verb_set',
          needed,
          verbSource: resolved.verbSource,
        });
        continue;
      }
      seenKeys.add(key);

      const commands = listCommands(db);
      if (stagingAlreadyCovers(commands, needed)) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'already_covered',
          needed,
          verbSource: resolved.verbSource,
        });
        continue;
      }

      const parent = pickCoverageParent(commands, needed, primaryVerb);
      if (!parent) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'no_parent',
          needed,
          verbSource: resolved.verbSource,
        });
        continue;
      }

      const missing = needed.filter(
        (v) => !recipeVerbSet(parent.command_recipe).has(v),
      );

      try {
        const validated = await generateAndValidate(
          {
            command: primaryCommand(parent.command_recipe) || 'git',
            blocks: [
              {
                metadata_source: 'recovery/coverage_gap',
                content: `target_verbs=${needed.join(', ')}; missing=${missing.join(', ')}; parent=${parent.row_id}`,
              },
            ],
          },
          {
            generate: async (_g, genOpts = {}) => {
              const raw = await evolveCompositionMutation(parent, [], {
                llmJsonObject: opts.llmJsonObject,
                target_verbs: needed,
                skipGuard: false,
              });
              if (genOpts.feedback) {
                return evolveCompositionMutation(parent, [], {
                  llmJsonObject: opts.llmJsonObject,
                  target_verbs: needed,
                  skipGuard: false,
                });
              }
              return { ...raw, mutation_kind: 'composition' };
            },
            validate: opts.validate,
            workerId: 0,
            jobId: `coverage-gap-${miss.command_id || 'x'}`,
            llmJsonObject: opts.llmJsonObject,
          },
        );

        if (!validated.ok) {
          attempts.push({
            command_id: miss.command_id,
            reason: 'validate_fail',
            detail: validated.reason,
            needed,
            verbSource: resolved.verbSource,
            parent_id: parent.row_id,
          });
          continue;
        }

        const childVerbs = recipeVerbSet(validated.command_recipe);
        const coveredNow = recipeCoversVerbs(childVerbs, needed);
        const addedMissing = missing.some((v) => childVerbs.has(v));
        if (!coveredNow && !addedMissing) {
          attempts.push({
            command_id: miss.command_id,
            reason: 'no_progress',
            needed,
            verbSource: resolved.verbSource,
            childVerbs: [...childVerbs],
            parent_id: parent.row_id,
          });
          continue;
        }

        const polished = await polishRecipeHygiene(
          { ...validated, mutation_kind: 'composition' },
          {
            llmJsonObject: opts.llmJsonObject,
            validate: opts.validate,
            jobId: `coverage-polish-${miss.command_id || 'x'}`,
            log,
          },
        );

        const intents = opts.expandIntents
          ? await opts.expandIntents(polished)
          : await expandIntentsForRecipe(
              { ...polished, mutation_kind: 'composition' },
              {
                llmJsonObject: opts.llmJsonObject,
                embedder: opts.embedder,
                knnForeign: null,
              },
            );

        const row_id = insertCommand(db, {
          initial_state: polished.initial_state,
          command_recipe: polished.command_recipe,
          initial_state_physical_hash: polished.initial_state_physical_hash,
          final_state_physical_hash: polished.final_state_physical_hash,
          risk: polished.risk,
          parent_row_id: parent.row_id,
          mutation_kind: 'composition',
          title: polished.title,
        });
        for (const intent of Array.isArray(intents) ? intents : []) {
          const embedding = await opts.embedder.embed(intent.intent_text);
          insertIntentWithEmbedding(db, {
            command_id: row_id,
            skill_level: intent.skill_level,
            intent_category: intent.intent_category,
            intent_text: intent.intent_text,
            embedding,
          });
        }
        const cEmb = await opts.embedder.embed(
          commandEmbedText({
            ...polished,
            command_recipe: polished.command_recipe,
          }),
        );
        insertCommandEmbedding(db, row_id, cEmb);

        insertedIds.push(row_id);
        birthQueries.push({
          row_id,
          query_text: queryText,
          primary_verb: primaryVerb || needed[0] || null,
          gap_command_id: miss.command_id ?? null,
          verbSource: resolved.verbSource,
        });
        attempts.push({
          command_id: miss.command_id,
          reason: 'inserted',
          row_id,
          parent_id: parent.row_id,
          needed,
          verbSource: resolved.verbSource,
          covered: coveredNow,
        });
        log(
          `coverage_gap INSERT child=${row_id} parent=${parent.row_id} verbs=${needed.join('+')} via=${resolved.verbSource}`,
        );
      } catch (e) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'error',
          error: String(e?.message || e),
          needed,
          verbSource: resolved.verbSource,
          parent_id: parent.row_id,
        });
        log(`coverage_gap fail: ${e?.message || e}`);
      }
    }
  } finally {
    if (ownsDb) db.close();
  }

  return { insertedIds, attempts, birthQueries };
}

/**
 * Roll back additive inserts from a rejected recovery attempt.
 * @param {string} stagingPath
 * @param {number[]} insertedIds
 * @param {object} [db]
 */
export function rollbackCoverageInserts(stagingPath, insertedIds, db) {
  if (!insertedIds?.length) return { deleted: 0 };
  const ownsDb = !db;
  const handle = db || openDb(stagingPath);
  let deleted = 0;
  try {
    for (const id of insertedIds) {
      if (getCommand(handle, id)) {
        deleteCommandCascade(handle, id);
        deleted += 1;
      }
    }
  } finally {
    if (ownsDb) handle.close();
  }
  return { deleted };
}
