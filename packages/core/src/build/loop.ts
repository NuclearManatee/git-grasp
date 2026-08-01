/**
 * Interactive loop retrieval + parent selection (multi-axis).
 */
import { knnRecall, knnRecallCommands, listCommands, getCommand } from '../db/schema.js';
import { mockEmbed } from '../search/embed.js';
import { parseCommands, primaryCommand } from '../db/recipeFormat.js';
import { LOOP_MAX_BATCH } from '../db/constants.js';
import {
  buildVerbCoverage,
  allVerbsSaturated,
  assignMutationKind,
} from './coverage.js';
import { selectEvolutionParentsFromRows, listLeaves } from './loopSelect.js';

function recipeText(row) {
  const steps = parseCommands(row.command_recipe);
  return `${row.initial_state}\n${steps.map((s) => s.command).join('\n')}`;
}

/**
 * Soft 2+2+2+2+2 retrieval mix, optionally biased toward mutation_kind.
 */
export async function retrieveEvolutionExamples(
  db,
  parent,
  embedFn = mockEmbed,
  opts = {},
) {
  const qText = recipeText(parent);
  const qVec = await embedFn(qText);
  const intentHits = knnRecall(db, qVec, 20);
  const cmdHits = knnRecallCommands(db, qVec, 20);
  const all = listCommands(db);
  const kind = opts.mutationKind;

  const kindRank = (row) => {
    if (!kind || !row) return 0;
    if (row.mutation_kind === kind) return 2;
    if (kind === 'composition') {
      const n = parseCommands(row.command_recipe).length;
      return n >= 2 ? 1 : 0;
    }
    if (kind === 'flag') {
      const body = JSON.stringify(row.command_recipe);
      return /--|[^-]-\w/.test(body) ? 1 : 0;
    }
    if (kind === 'state') {
      const s = String(row.initial_state || '');
      return /remote|echo|dirty|detach|GIT_GRASP/i.test(s) ? 1 : 0;
    }
    return 0;
  };

  const byIntentSim = intentHits.map((h) => Number(h.command_id));
  const byRecipeSim = cmdHits.map((h) => h.command_id);
  const byIntentDist = [...byIntentSim].reverse();
  const byRecipeDist = [...byRecipeSim].reverse();

  const pick = (ids, n, exclude) => {
    const ranked = [...ids].sort((a, b) => {
      const ra = kindRank(getCommand(db, a));
      const rb = kindRank(getCommand(db, b));
      return rb - ra;
    });
    const out = [];
    for (const id of ranked) {
      if (exclude.has(id) || id === parent.row_id) continue;
      out.push(id);
      exclude.add(id);
      if (out.length >= n) break;
    }
    return out;
  };

  const exclude = new Set();
  const ids = [
    ...pick(byIntentSim, 2, exclude),
    ...pick(byRecipeSim, 2, exclude),
    ...pick(byIntentDist, 2, exclude),
    ...pick(byRecipeDist, 2, exclude),
  ];

  const shuffled = [...all].sort((a, b) => kindRank(b) - kindRank(a) || Math.random() - 0.5);
  for (const row of shuffled) {
    if (ids.length >= 10) break;
    if (exclude.has(row.row_id) || row.row_id === parent.row_id) continue;
    ids.push(row.row_id);
    exclude.add(row.row_id);
  }

  return ids.map((id) => getCommand(db, id)).filter(Boolean);
}

export function selectEvolutionParents(db, limit = LOOP_MAX_BATCH, opts = {}) {
  return selectEvolutionParentsFromRows(listCommands(db), limit, opts);
}

export function computeLoopCoverage(db) {
  return buildVerbCoverage(listCommands(db));
}

export function loopAllVerbsSaturated(db, taxonomyVerbs) {
  const coverage = computeLoopCoverage(db);
  return allVerbsSaturated(coverage, taxonomyVerbs);
}

export function countLeaves(db) {
  return listLeaves(listCommands(db)).length;
}

export {
  recipeText,
  primaryCommand,
  buildVerbCoverage,
  allVerbsSaturated,
  assignMutationKind,
  selectEvolutionParentsFromRows,
};
