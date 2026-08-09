// @ts-nocheck
/**
 * Merge recipes that share a structural command fingerprint.
 * Prefer placeholder-canonical forms; fold paraphrases / descriptions into keeper.
 */
import {
  rewriteCommandsPlaceholders,
  needsPlaceholderRewrite,
  structuralCommandFingerprint,
} from './argvNormalize.js';
import { parseCommands } from '../db/recipeFormat.js';

function scoreKeeper(recipe) {
  const cmds = parseCommands(recipe.commands);
  const literalPenalty = cmds.some((s) => needsPlaceholderRewrite(s.command))
    ? 0
    : 10;
  const paras = Array.isArray(recipe.paraphrases) ? recipe.paraphrases.length : 0;
  const desc = String(recipe.description || '').length;
  const validated = recipe.validated ? 5 : 0;
  return literalPenalty * 1000 + validated * 100 + paras * 10 + Math.min(desc, 500);
}

function mergeInto(keeper, donor) {
  const paras = new Set([
    ...(Array.isArray(keeper.paraphrases) ? keeper.paraphrases : []),
    ...(Array.isArray(donor.paraphrases) ? donor.paraphrases : []),
  ]);
  const donorDesc = String(donor.description || '').trim();
  const keepDesc = String(keeper.description || '').trim();
  if (donorDesc && donorDesc !== keepDesc) {
    paras.add(donorDesc);
  }
  const donorTitle = String(donor.title || '').trim();
  if (donorTitle && donorTitle !== String(keeper.title || '').trim()) {
    paras.add(donorTitle);
  }
  // Prefer longer description on keeper when donor is richer
  let description = keepDesc;
  if (donorDesc.length > keepDesc.length * 1.2) {
    paras.add(keepDesc);
    description = donorDesc;
  }
  const tags = [
    ...new Set([
      ...(Array.isArray(keeper.tags) ? keeper.tags : []),
      ...(Array.isArray(donor.tags) ? donor.tags : []),
    ]),
  ];
  return {
    ...keeper,
    description,
    tags,
    paraphrases: [...paras].filter(Boolean),
    commands: rewriteCommandsPlaceholders(keeper.commands),
    command_fingerprint:
      keeper.command_fingerprint ||
      structuralCommandFingerprint(keeper.commands),
  };
}

/**
 * @param {object[]} recipes
 * @param {{ scope?: 'leaf'|'global' }} [opts]
 * @returns {{ recipes: object[], removed: number, groups: number }}
 */
export function mergeRecipesByStructuralFingerprint(recipes, opts = {}) {
  const scope = opts.scope || 'leaf';
  const groups = new Map();

  for (const raw of recipes || []) {
    const commands = rewriteCommandsPlaceholders(raw.commands || raw);
    const fp = structuralCommandFingerprint(commands);
    const leaf = String(raw.taxonomy_leaf || '');
    const key = scope === 'global' ? fp : `${leaf}::${fp}`;
    const normalized = {
      ...raw,
      commands,
      command_fingerprint: fp,
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(normalized);
  }

  const out = [];
  let removed = 0;
  for (const cluster of groups.values()) {
    if (cluster.length === 1) {
      out.push(cluster[0]);
      continue;
    }
    cluster.sort((a, b) => scoreKeeper(b) - scoreKeeper(a));
    let keeper = cluster[0];
    for (let i = 1; i < cluster.length; i += 1) {
      keeper = mergeInto(keeper, cluster[i]);
      removed += 1;
    }
    out.push(keeper);
  }

  return {
    recipes: out,
    removed,
    groups: groups.size,
    before: (recipes || []).length,
    after: out.length,
  };
}
