// @ts-nocheck
/**
 * Goal taxonomy builder: brainstorm → decompose (caps) → map leaves to git
 * commands → programmatic coverage → ≤N LLM reflection rounds.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pLimit from 'p-limit';
import { renderPrompt } from '../lib/prompts.js';
import { llmJsonObject } from '../lib/llm.js';
import {
  goalTaxonomyPath,
  gitCommandsTaxonomyPath,
  localDir,
} from '../lib/paths.js';
import {
  TAXONOMY_MAX_DEPTH,
  TAXONOMY_MAX_FANOUT,
  TAXONOMY_REFLECTION_ROUNDS,
  LEAF_CONCURRENCY,
} from '../db/constants.js';
import {
  BrainstormGoalsLlmSchema,
  DecomposeNodeLlmSchema,
  MapLeafCommandsLlmSchema,
  ReflectTaxonomyLlmSchema,
  CoverUnmappedLlmSchema,
  GoalTaxonomyFileSchema,
} from '../schemas/goalTaxonomy.js';

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[taxonomy:goals ${ts}]`, ...args);
}

function slugify(name, used) {
  let base = String(name || 'node')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'node';
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Load available command strings from scraped git_commands.json.
 * @returns {string[]} e.g. ["git status", "git commit", ...]
 */
export function loadScrapedCommandList(taxonomyPath = gitCommandsTaxonomyPath()) {
  if (!existsSync(taxonomyPath)) {
    throw new Error(`Missing git commands taxonomy: ${taxonomyPath}`);
  }
  const doc = JSON.parse(readFileSync(taxonomyPath, 'utf8'));
  const cmds = Array.isArray(doc.commands) ? doc.commands : [];
  return cmds
    .filter((c) => c && c.available !== false)
    .map((c) => String(c.command || `git ${c.name}`).trim())
    .filter(Boolean);
}

/**
 * Programmatic coverage / hygiene over mapped leaves.
 */
export function computeTaxonomyCoverage(leaves, scrapedCommands) {
  const scraped = new Set(scrapedCommands.map(String));
  const mapped = new Set();
  const empty_leaves = [];
  const idCounts = new Map();
  for (const leaf of leaves) {
    idCounts.set(leaf.id, (idCounts.get(leaf.id) || 0) + 1);
    const cmds = Array.isArray(leaf.mapped_commands) ? leaf.mapped_commands : [];
    if (cmds.length === 0) empty_leaves.push(leaf.id);
    for (const c of cmds) {
      if (scraped.has(c)) mapped.add(c);
    }
  }
  const duplicate_leaf_ids = [...idCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  const commands_unmapped = [...scraped].filter((c) => !mapped.has(c)).sort();
  return {
    commands_total: scraped.size,
    commands_mapped: mapped.size,
    commands_unmapped,
    empty_leaves,
    duplicate_leaf_ids,
  };
}

/**
 * Collect leaf nodes from a forest (nodes with is_leaf or no children).
 */
export function collectLeaves(roots, pathNames = []) {
  const out = [];
  for (const node of roots || []) {
    const path = [...pathNames, node.name];
    const children = node.children || [];
    const isLeaf =
      node.is_leaf === true ||
      children.length === 0 ||
      (Array.isArray(node.mapped_commands) && node.mapped_commands.length > 0 && children.length === 0);
    if (isLeaf || children.length === 0) {
      out.push({
        id: node.id,
        name: node.name,
        description: node.description,
        depth: node.depth,
        parent_id: node.parent_id ?? null,
        mapped_commands: node.mapped_commands || [],
        path,
      });
    } else {
      out.push(...collectLeaves(children, path));
    }
  }
  return out;
}

/**
 * Cap children array to max fan-out.
 */
export function capFanout(children, maxFanout) {
  if (!Array.isArray(children)) return [];
  return children.slice(0, Math.max(0, maxFanout));
}

/**
 * Apply merge/rename reflection patches onto a forest (mutates copy).
 */
export function applyReflectionPatches(roots, patches) {
  const byId = new Map();
  function index(nodes) {
    for (const n of nodes || []) {
      byId.set(n.id, n);
      index(n.children);
    }
  }
  index(roots);

  for (const r of patches?.rename || []) {
    const n = byId.get(r.id);
    if (!n) continue;
    if (r.name) n.name = r.name;
    if (r.description) n.description = r.description;
  }

  const drop = new Set();
  for (const m of patches?.merge || []) {
    for (const id of m.drop_ids || []) drop.add(id);
  }

  function prune(nodes) {
    return (nodes || [])
      .filter((n) => !drop.has(n.id))
      .map((n) => ({ ...n, children: prune(n.children) }));
  }
  return prune(roots);
}

function normalizeCommandToken(raw, scrapedSet) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (!s.startsWith('git ')) s = `git ${s.replace(/^git\s+/, '')}`;
  // Prefer exact scraped match
  for (const c of scrapedSet) {
    if (c.toLowerCase() === s) return c;
  }
  // Match verb-only
  const verb = s.replace(/^git\s+/, '').split(/\s+/)[0];
  for (const c of scrapedSet) {
    const cv = c.toLowerCase().replace(/^git\s+/, '').split(/\s+/)[0];
    if (cv === verb) return c;
  }
  return null;
}

/**
 * Assign unmapped scraped commands onto existing leaves or create new leaves.
 * Mutates `leaves` / returns updated roots forest.
 */
export async function coverUnmappedCommands(roots, leaves, scrapedCommands, opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const usedIds = opts.usedIds || new Set(leaves.map((l) => l.id));
  let coverage = computeTaxonomyCoverage(leaves, scrapedCommands);
  if (!coverage.commands_unmapped.length) {
    return { roots, leaves, coverage, rounds: 0 };
  }

  const limit = pLimit(opts.concurrency || LEAF_CONCURRENCY);
  const chunks = [];
  const unmapped = [...coverage.commands_unmapped];
  const chunkSize = opts.chunkSize || 16;
  for (let i = 0; i < unmapped.length; i += chunkSize) {
    chunks.push(unmapped.slice(i, i + chunkSize));
  }

  let rounds = 0;
  for (const chunk of chunks) {
    rounds += 1;
    log(`cover unmapped round ${rounds}: ${chunk.length} commands`);
    const { messages } = renderPrompt('taxonomy/cover-unmapped', {
      unmapped_json: JSON.stringify(chunk, null, 2),
      leaves_json: JSON.stringify(
        leaves.map((l) => ({
          id: l.id,
          name: l.name,
          description: l.description,
          mapped_commands: l.mapped_commands,
        })),
        null,
        2,
      ),
    });
    const drafted = await call({
      schema: CoverUnmappedLlmSchema,
      messages,
    });

    const byId = new Map(leaves.map((l) => [l.id, l]));
    for (const a of drafted.assign || []) {
      const cmd = normalizeCommandToken(a.command, new Set(scrapedCommands));
      const leaf = byId.get(a.leaf_id);
      if (!cmd || !leaf) continue;
      if (!leaf.mapped_commands.includes(cmd)) leaf.mapped_commands.push(cmd);
    }

    const backfillRootId = 'coverage-backfill';
    let backfillRoot = roots.find((r) => r.id === backfillRootId);
    if (!backfillRoot) {
      backfillRoot = {
        id: backfillRootId,
        name: 'Coverage backfill',
        description: 'Leaves created to cover scraped commands missed by top-down decompose',
        depth: 0,
        parent_id: null,
        children: [],
        mapped_commands: [],
        is_leaf: false,
      };
      roots.push(backfillRoot);
      usedIds.add(backfillRootId);
    }

    for (const nl of drafted.new_leaves || []) {
      const cmds = [];
      for (const raw of nl.commands || []) {
        const n = normalizeCommandToken(raw, new Set(scrapedCommands));
        if (n && !cmds.includes(n)) cmds.push(n);
      }
      if (!cmds.length) continue;
      const id = slugify(nl.id || `backfill-${nl.name}`, usedIds);
      const leaf = {
        id,
        name: nl.name,
        description: nl.description,
        depth: 1,
        parent_id: backfillRootId,
        mapped_commands: cmds,
        path: [backfillRoot.name, nl.name],
        is_leaf: true,
        children: [],
      };
      backfillRoot.children.push(leaf);
      leaves.push(leaf);
      byId.set(id, leaf);
    }

    // Deterministic residual: any still-unmapped in this chunk → one leaf each
    coverage = computeTaxonomyCoverage(leaves, scrapedCommands);
    for (const cmd of chunk) {
      if (!coverage.commands_unmapped.includes(cmd)) continue;
      const verb = cmd.replace(/^git\s+/i, '');
      const id = slugify(`backfill-${verb}`, usedIds);
      const leaf = {
        id,
        name: `Use ${cmd}`,
        description: `Accomplish tasks that require ${cmd}`,
        depth: 1,
        parent_id: backfillRootId,
        mapped_commands: [cmd],
        path: [backfillRoot.name, `Use ${cmd}`],
        is_leaf: true,
        children: [],
      };
      backfillRoot.children.push(leaf);
      leaves.push(leaf);
    }
  }

  // Re-sync tree mapped_commands onto leaf nodes
  function sync(nodes) {
    for (const n of nodes || []) {
      const leaf = leaves.find((l) => l.id === n.id);
      if (leaf) {
        n.mapped_commands = leaf.mapped_commands;
        n.is_leaf = true;
        n.children = [];
      } else if (n.children?.length) {
        sync(n.children);
      }
    }
  }
  sync(roots);
  leaves = collectLeaves(roots).filter((l) => l.mapped_commands?.length);
  coverage = computeTaxonomyCoverage(leaves, scrapedCommands);
  return { roots, leaves, coverage, rounds };
}

/**
 * @param {object} [opts]
 * @param {typeof llmJsonObject} [opts.llmJsonObject]
 * @param {string[]} [opts.scrapedCommands]
 * @param {number} [opts.maxDepth]
 * @param {number} [opts.maxFanout]
 * @param {number} [opts.reflectionRounds]
 * @param {string} [opts.outPath]
 * @param {boolean} [opts.fresh]
 */
export async function buildGoalTaxonomy(opts = {}) {
  const call = opts.llmJsonObject || llmJsonObject;
  const maxDepth = opts.maxDepth ?? TAXONOMY_MAX_DEPTH;
  const maxFanout = opts.maxFanout ?? TAXONOMY_MAX_FANOUT;
  const reflectionRounds = opts.reflectionRounds ?? TAXONOMY_REFLECTION_ROUNDS;
  const scrapedCommands = opts.scrapedCommands || loadScrapedCommandList();
  const scrapedSet = new Set(scrapedCommands);
  const outPath = opts.outPath || goalTaxonomyPath();
  const usedIds = new Set();
  const limit = pLimit(opts.concurrency || LEAF_CONCURRENCY);

  log('brainstorm categories');
  const { messages: brainstormMsgs } = renderPrompt('taxonomy/brainstorm-goals', {
    command_count: String(scrapedCommands.length),
    command_sample: scrapedCommands.slice(0, 40).join('\n'),
  });
  const brainstorm = await call({
    schema: BrainstormGoalsLlmSchema,
    messages: brainstormMsgs,
  });

  /** @type {any[]} */
  let roots = capFanout(brainstorm.categories, maxFanout).map((c) => ({
    id: slugify(c.name, usedIds),
    name: c.name,
    description: c.description,
    depth: 0,
    parent_id: null,
    children: [],
    mapped_commands: [],
    is_leaf: false,
  }));

  async function decomposeNode(node) {
    if (node.depth >= maxDepth) {
      node.is_leaf = true;
      return;
    }
    const { messages } = renderPrompt('taxonomy/decompose-node', {
      name: node.name,
      description: node.description,
      depth: String(node.depth),
      max_depth: String(maxDepth),
      max_fanout: String(maxFanout),
      path: node.id,
    });
    const drafted = await call({
      schema: DecomposeNodeLlmSchema,
      messages,
    });
    if (drafted.stop || !drafted.children?.length) {
      node.is_leaf = true;
      node.children = [];
      return;
    }
    const kids = capFanout(drafted.children, maxFanout).map((c) => ({
      id: slugify(`${node.id}-${c.name}`, usedIds),
      name: c.name,
      description: c.description,
      depth: node.depth + 1,
      parent_id: node.id,
      children: [],
      mapped_commands: [],
      is_leaf: Boolean(c.stop) || node.depth + 1 >= maxDepth,
    }));
    node.children = kids;
    await Promise.all(
      kids
        .filter((k) => !k.is_leaf)
        .map((k) => limit(() => decomposeNode(k))),
    );
    for (const k of kids) {
      if (!k.children?.length) k.is_leaf = true;
    }
  }

  log(`decompose ${roots.length} roots (maxDepth=${maxDepth}, fanout=${maxFanout})`);
  await Promise.all(roots.map((r) => limit(() => decomposeNode(r))));

  let leaves = collectLeaves(roots);
  log(`map ${leaves.length} leaves to commands`);
  await Promise.all(
    leaves.map((leaf) =>
      limit(async () => {
        const { messages } = renderPrompt('taxonomy/map-leaf-commands', {
          leaf_name: leaf.name,
          leaf_description: leaf.description,
          leaf_path: (leaf.path || []).join(' > '),
          commands_json: JSON.stringify(scrapedCommands, null, 0),
        });
        const mapped = await call({
          schema: MapLeafCommandsLlmSchema,
          messages,
        });
        if (mapped.discard) {
          leaf.mapped_commands = [];
          leaf._discard = true;
          return;
        }
        const cmds = [];
        for (const raw of mapped.commands || []) {
          const n = normalizeCommandToken(raw, scrapedSet);
          if (n && !cmds.includes(n)) cmds.push(n);
        }
        leaf.mapped_commands = cmds;
      }),
    ),
  );

  function attachMapped(nodes) {
    for (const n of nodes || []) {
      const leaf = leaves.find((l) => l.id === n.id);
      if (leaf) {
        n.mapped_commands = leaf.mapped_commands || [];
        n.is_leaf = true;
        n.children = [];
      } else if (n.children?.length) {
        attachMapped(n.children);
      }
    }
  }
  attachMapped(roots);

  function pruneEmpty(nodes) {
    return (nodes || [])
      .map((n) => {
        if (n.children?.length) {
          return { ...n, children: pruneEmpty(n.children) };
        }
        if (!n.mapped_commands?.length) return null;
        return n;
      })
      .filter(Boolean);
  }
  roots = pruneEmpty(roots);
  leaves = collectLeaves(roots).filter((l) => l.mapped_commands?.length);

  let rounds = 0;
  for (let i = 0; i < reflectionRounds; i += 1) {
    rounds = i + 1;
    const coverageMid = computeTaxonomyCoverage(leaves, scrapedCommands);
    const { messages } = renderPrompt('taxonomy/reflect-taxonomy', {
      leaves_json: JSON.stringify(
        leaves.map((l) => ({
          id: l.id,
          name: l.name,
          description: l.description,
          mapped_commands: l.mapped_commands,
        })),
        null,
        2,
      ),
      coverage_json: JSON.stringify(coverageMid, null, 2),
      round: String(rounds),
    });
    const patches = await call({
      schema: ReflectTaxonomyLlmSchema,
      messages,
    });
    if (
      (!patches.rename || patches.rename.length === 0) &&
      (!patches.merge || patches.merge.length === 0)
    ) {
      log(`reflection round ${rounds}: no changes`);
      break;
    }
    roots = applyReflectionPatches(roots, patches);
    leaves = collectLeaves(roots).filter((l) => l.mapped_commands?.length);
    log(`reflection round ${rounds}: applied patches`);
  }

  const covered = await coverUnmappedCommands(roots, leaves, scrapedCommands, {
    llmJsonObject: call,
    usedIds,
    concurrency: opts.concurrency || LEAF_CONCURRENCY,
  });
  roots = covered.roots;
  leaves = covered.leaves;
  const coverage = covered.coverage;

  const doc = {
    version: 1,
    created_at: new Date().toISOString(),
    max_depth: maxDepth,
    max_fanout: maxFanout,
    reflection_rounds: rounds,
    cover_rounds: covered.rounds,
    roots,
    leaves,
    coverage,
  };
  GoalTaxonomyFileSchema.parse(doc);

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

  const reportDir = path.join(localDir(), 'eval', 'goal-taxonomy');
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(
    path.join(reportDir, 'latest-coverage.json'),
    `${JSON.stringify(coverage, null, 2)}\n`,
    'utf8',
  );

  log(
    `wrote ${outPath} leaves=${leaves.length} mapped=${coverage.commands_mapped}/${coverage.commands_total}`,
  );

  const ok =
    coverage.empty_leaves.length === 0 &&
    coverage.duplicate_leaf_ids.length === 0 &&
    coverage.commands_unmapped.length === 0;

  return {
    ok,
    outPath,
    leaves,
    coverage,
    reflection_rounds: rounds,
    cover_rounds: covered.rounds,
  };
}

export function readGoalTaxonomy(filePath = goalTaxonomyPath()) {
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  return GoalTaxonomyFileSchema.parse(raw);
}
