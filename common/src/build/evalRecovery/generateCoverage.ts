// @ts-nocheck
/**
 * Generate missing composite recipes for coverage_gap misses (additive only).
 */
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
import { evolveCompositionMutation } from '../generate.js';
import { expandIntentsForRecipe } from '../intentExpand.js';
import { generateAndValidate } from '../validate.js';
import { polishRecipeHygiene } from '../polishRecipe.js';
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
 * }} opts
 * @returns {Promise<{ insertedIds: number[], attempts: object[] }>}
 */
export async function generateCoverageGapComposites(coverageGapMisses, opts) {
  const log = opts.log || (() => {});
  const maxInserts = opts.maxInserts ?? 3;
  const ownsDb = !opts.db;
  const db = opts.db || openDb(opts.stagingPath);
  /** @type {number[]} */
  const insertedIds = [];
  /** @type {object[]} */
  const attempts = [];

  try {
    const seenKeys = new Set();
    for (const miss of coverageGapMisses || []) {
      if (insertedIds.length >= maxInserts) break;
      const queryText = miss.query_text || miss.row?.query?.query_text || '';
      const primaryVerb =
        miss.primary_verb || miss.row?.query?.primary_verb || null;
      const needed = queryGitVerbs(queryText);
      if (needed.length < 2) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'need_two_verbs',
          needed,
        });
        continue;
      }
      const key = needed.slice().sort().join('|');
      if (seenKeys.has(key)) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'dup_verb_set',
          needed,
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
        });
        continue;
      }

      const parent = pickCoverageParent(commands, needed, primaryVerb);
      if (!parent) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'no_parent',
          needed,
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
        attempts.push({
          command_id: miss.command_id,
          reason: 'inserted',
          row_id,
          parent_id: parent.row_id,
          needed,
          covered: coveredNow,
        });
        log(
          `coverage_gap INSERT child=${row_id} parent=${parent.row_id} verbs=${needed.join('+')}`,
        );
      } catch (e) {
        attempts.push({
          command_id: miss.command_id,
          reason: 'error',
          error: String(e?.message || e),
          needed,
          parent_id: parent.row_id,
        });
        log(`coverage_gap fail: ${e?.message || e}`);
      }
    }
  } finally {
    if (ownsDb) db.close();
  }

  return { insertedIds, attempts };
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
