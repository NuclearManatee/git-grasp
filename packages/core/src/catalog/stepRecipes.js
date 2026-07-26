import {
  validateRecipe,
  validateExample,
  recipeSlugFromTitle,
  normalizeExample,
  commandSlug,
} from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { normalizeUsage } from '../db/utils.js';
import { loadCheatSheetExamples } from './sources/cheatSheet.js';
import { loadTldrExamples, mergeCommandUniverse } from './sources/tldr.js';
import { loadProgitBlocks } from './sources/progit.js';
import { loadManOracle, makeFlagValidator } from './sources/manOracle.js';
import { PACKAGE_ROOT } from '../lib/paths.js';

/**
 * Derive command family key from a run line.
 * @param {string} run
 */
export function deriveCommandKey(run) {
  const parts = normalizeExample(run).split(/\s+/);
  if (parts[0] === 'git' && parts[1] && !parts[1].startsWith('-')) {
    return `git ${parts[1]}`;
  }
  return parts[0] === 'git' ? 'git' : normalizeExample(run);
}

function titleFromRun(run, comment) {
  if (comment) return comment.charAt(0).toUpperCase() + comment.slice(1);
  const parts = normalizeExample(run).split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

/**
 * Build single-step recipes from the merged command universe.
 * @param {Array<{ run: string, comment?: string, source?: string }>} universe
 * @param {{ glossary?: object, validateFlags?: Function }} [opts]
 */
export function recipesFromUniverse(universe, {
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
} = {}) {
  const recipes = [];
  const seen = new Set();
  for (const item of universe) {
    let run = materializePlaceholders(item.run, glossary);
    run = normalizeExample(run);
    const v = validateExample(run);
    if (!v.ok) continue;
    if (validateFlags) {
      const f = validateFlags(run);
      if (!f?.ok) continue;
    }
    if (seen.has(run)) continue;
    seen.add(run);

    const title = titleFromRun(run, item.comment);
    let id = recipeSlugFromTitle(title);
    if (seen.has(`id:${id}`)) id = `${id}-${commandSlug(run).slice(0, 24)}`;
    seen.add(`id:${id}`);

    const recipe = {
      id,
      title,
      commands: [{ run, comment: item.comment || '' }],
      explanation: item.comment
        ? `${item.comment}.`
        : `Runs \`${run}\`.`,
      intent_family: '',
      simplicity_rank: 1,
      usage: normalizeUsage({
        command_line: run,
        blurb: item.comment || '',
      }, run),
      topic: topicFromCommand(deriveCommandKey(run)),
      primary_example: run,
      command: deriveCommandKey(run),
      source: item.source || 'universe',
    };
    const check = validateRecipe(recipe, { validateFlags: validateFlags || undefined });
    if (!check.ok) continue;
    recipes.push(recipe);
  }
  return recipes;
}

function topicFromCommand(command) {
  const sub = String(command).replace(/^git\s+/, '');
  const map = {
    status: 'status', add: 'stage', commit: 'commit', branch: 'branch',
    switch: 'branch', checkout: 'branch', merge: 'merge', rebase: 'rebase',
    reset: 'undo', restore: 'undo', revert: 'undo', stash: 'stash',
    pull: 'sync', push: 'sync', fetch: 'sync', log: 'history', diff: 'diff',
    clone: 'create', init: 'create', tag: 'tag', remote: 'remote',
  };
  return map[sub] || 'advanced';
}

/**
 * Multi-step recipes from Pro Git blocks (only if every run validates).
 * Cheat-sheet/tldr hierarchy applies only on single-run conflicts (already in universe).
 */
export function recipesFromProgitBlocks(blocks, {
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
  existingRuns = new Set(),
} = {}) {
  const recipes = [];
  const seenIds = new Set();
  for (const block of blocks || []) {
    const runs = (block.runs || [])
      .map((r) => normalizeExample(materializePlaceholders(r, glossary)))
      .filter(Boolean);
    if (runs.length < 2) continue;

    const commands = [];
    let ok = true;
    for (const run of runs) {
      const v = validateExample(run);
      if (!v.ok) { ok = false; break; }
      if (validateFlags) {
        const f = validateFlags(run);
        if (!f?.ok) { ok = false; break; }
      }
      commands.push({ run, comment: '' });
    }
    if (!ok) continue;

    // Skip if identical to an existing single-run already covered and only 1 unique
    const primary = commands[0].run;
    const title = `Workflow: ${primary}`;
    let id = recipeSlugFromTitle(`${block.chapter || 'progit'}-${primary}`);
    if (seenIds.has(id)) id = `${id}-${recipes.length}`;
    seenIds.add(id);

    recipes.push({
      id,
      title,
      commands,
      explanation: `Multi-step workflow from Pro Git (${block.chapter || 'chapter'}).`,
      intent_family: '',
      simplicity_rank: 2,
      usage: normalizeUsage({
        command_line: primary,
        blurb: 'Multi-step Git workflow',
      }, primary),
      topic: topicFromCommand(deriveCommandKey(primary)),
      primary_example: primary,
      command: deriveCommandKey(primary),
      source: 'progit',
    });
  }
  return recipes;
}

/**
 * Single-step recipes from individual Pro Git command lines (fills gaps beyond tldr/CS).
 */
export function recipesFromProgitSingles(blocks, {
  glossary = DEFAULT_GLOSSARY,
  validateFlags = null,
  existingRuns = new Set(),
} = {}) {
  const recipes = [];
  const seen = new Set(existingRuns);
  const seenIds = new Set();
  for (const block of blocks || []) {
    for (const raw of block.runs || []) {
      let run = normalizeExample(materializePlaceholders(raw, glossary));
      if (!run || seen.has(run)) continue;
      const v = validateExample(run);
      if (!v.ok) continue;
      if (validateFlags) {
        const f = validateFlags(run);
        if (!f?.ok) continue;
      }
      seen.add(run);
      const title = titleFromRun(run, '');
      let id = recipeSlugFromTitle(`progit-${run}`);
      if (seenIds.has(id)) id = `${id}-${commandSlug(run).slice(0, 16)}`;
      seenIds.add(id);
      recipes.push({
        id,
        title,
        commands: [{ run, comment: '' }],
        explanation: `From Pro Git (${block.chapter || 'chapter'}).`,
        intent_family: '',
        simplicity_rank: 1,
        usage: normalizeUsage({ command_line: run, blurb: '' }, run),
        topic: topicFromCommand(deriveCommandKey(run)),
        primary_example: run,
        command: deriveCommandKey(run),
        source: 'progit-single',
      });
    }
  }
  return recipes;
}

/**
 * Full offline recipe synthesis from cached sources.
 */
export function synthesizeRecipes({
  root = PACKAGE_ROOT,
  glossary = DEFAULT_GLOSSARY,
  oracle = null,
} = {}) {
  const man = oracle || loadManOracle(root);
  const validateFlags = man ? makeFlagValidator(man) : null;
  const cs = loadCheatSheetExamples(root);
  const tldr = loadTldrExamples(root);
  const universe = mergeCommandUniverse(cs, tldr);
  const singles = recipesFromUniverse(universe, { glossary, validateFlags });
  const existingRuns = new Set(singles.map((r) => r.primary_example));
  const blocks = loadProgitBlocks(root);
  const multi = recipesFromProgitBlocks(blocks, {
    glossary,
    validateFlags,
    existingRuns,
  });
  for (const r of multi) existingRuns.add(r.primary_example);
  const progitSingles = recipesFromProgitSingles(blocks, {
    glossary,
    validateFlags,
    existingRuns,
  });

  const byId = new Map();
  for (const r of [...singles, ...multi, ...progitSingles]) {
    if (!byId.has(r.id)) byId.set(r.id, r);
  }
  return [...byId.values()];
}

/**
 * Deterministic fixture recipes (tests / offline without network).
 */
export function fixtureRecipes() {
  return [
    {
      id: 'undo-last-commit-keep-changes',
      title: 'Undo last commit keep changes',
      commands: [
        { run: 'git reset --soft HEAD~1', comment: 'Move HEAD back one commit; keep changes staged' },
      ],
      explanation: 'Moves HEAD back one commit, keeps index and worktree.',
      intent_family: 'soft-undo',
      simplicity_rank: 1,
      usage: 'git reset --soft HEAD~1\nMoves HEAD back one commit and keeps changes staged.',
      topic: 'undo',
      primary_example: 'git reset --soft HEAD~1',
      command: 'git reset',
    },
    {
      id: 'show-working-tree-status',
      title: 'Show working tree status',
      commands: [
        { run: 'git status', comment: 'Show staged, unstaged, and untracked files' },
      ],
      explanation: 'Shows working tree status.',
      intent_family: 'status',
      simplicity_rank: 1,
      usage: 'git status\nShow working tree status.',
      topic: 'status',
      primary_example: 'git status',
      command: 'git status',
    },
    {
      id: 'topic-branch-and-merge',
      title: 'Create topic branch and merge',
      commands: [
        { run: 'git switch -c feature/login', comment: 'Create and switch to a topic branch' },
        { run: 'git switch main', comment: 'Return to main' },
        { run: 'git merge feature/login', comment: 'Merge the topic branch' },
      ],
      explanation: 'Create a topic branch, then merge it back into main.',
      intent_family: 'branch-merge',
      simplicity_rank: 2,
      usage: 'git switch -c feature/login\nCreate a topic branch then merge later.',
      topic: 'branch',
      primary_example: 'git switch -c feature/login',
      command: 'git switch',
    },
  ];
}
