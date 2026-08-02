// @ts-nocheck
/**
 * Coverage helpers: recipe verb sets vs multi-action query verbs.
 */
import { verbFromCommandLine } from '../coverage.js';
import { parseCommands } from '../../db/recipeFormat.js';

function normVerb(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * English nouns that often follow "git " in NL queries but are not subcommands.
 * Prevents "git repository" / "git history" from counting as verbs.
 */
const NON_COMMAND_AFTER_GIT = new Set([
  'repository',
  'repo',
  'history',
  'command',
  'commands',
  'workflow',
  'project',
  'working',
  'tree',
  'index',
  'object',
  'objects',
  'file',
  'files',
]);

/**
 * Git verbs named in query text (`git foo` tokens).
 * Filters out common NL false positives like "git repository".
 * @param {string} queryText
 * @param {{ knownVerbs?: string[] }} [opts]
 * @returns {string[]}
 */
export function queryGitVerbs(queryText, opts = {}) {
  const found = [];
  const re = /\bgit\s+[a-z0-9][-a-z0-9]*/gi;
  let m;
  const text = String(queryText || '');
  const known = opts.knownVerbs?.length
    ? new Set(opts.knownVerbs.map(normVerb))
    : null;
  while ((m = re.exec(text))) {
    const v = verbFromCommandLine(m[0]);
    if (!v) continue;
    const n = normVerb(v);
    const bare = n.replace(/^git\s+/, '');
    if (NON_COMMAND_AFTER_GIT.has(bare)) continue;
    if (known && !known.has(n)) continue;
    found.push(n);
  }
  return [...new Set(found)];
}

/**
 * @param {string | object} commandRecipe
 * @returns {Set<string>}
 */
export function recipeVerbSet(commandRecipe) {
  /** @type {Set<string>} */
  const verbs = new Set();
  for (const s of parseCommands(commandRecipe)) {
    const v = verbFromCommandLine(s.command);
    if (v) verbs.add(normVerb(v));
  }
  return verbs;
}

/**
 * @param {Set<string>|string[]} recipeVerbs
 * @param {string[]} needed
 */
export function recipeCoversVerbs(recipeVerbs, needed) {
  const set =
    recipeVerbs instanceof Set
      ? recipeVerbs
      : new Set((recipeVerbs || []).map(normVerb));
  return (needed || []).every((v) => set.has(normVerb(v)));
}

/**
 * @param {object[]} commands listCommands rows
 * @returns {{ row_id: number, verbs: Set<string>, mutation_kind?: string|null }[]}
 */
export function buildRecipeVerbCoverage(commands) {
  return (commands || []).map((c) => ({
    row_id: Number(c.row_id),
    verbs: recipeVerbSet(c.command_recipe),
    mutation_kind: c.mutation_kind ?? null,
  }));
}

/**
 * True when some staging recipe already covers the full needed verb set.
 * @param {{ verbs: Set<string> }[]} coverage
 * @param {string[]} needed
 */
export function stagingCoversVerbSet(coverage, needed) {
  if (!needed?.length) return true;
  return (coverage || []).some((r) => recipeCoversVerbs(r.verbs, needed));
}
