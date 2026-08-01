/**
 * Step −1: paragraph chunking + OpenAI embed + multi-anchor taxonomy routing.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  PACKAGE_ROOT,
  semanticBlocksPath,
  unroutedChunksPath,
  prepareCacheDir,
  gitCommandsTaxonomyPath,
} from '../lib/paths.js';
import { createOpenAIEmbedder, cosineSimilarity } from './openaiEmbed.js';
import { SemanticBlocksFileSchema } from '../schemas/command.js';
import { taxonomyEmbedText } from './taxonomyScrape.js';
import { buildDefaultHelpBlock } from './gitShortHelp.js';

export const ROUTE_SIM_FLOOR = 0.75;
export const ROUTE_DELTA = 0.05;
export const ROUTE_MAX_ANCHORS = 3;

/** Fenced ``` line or sole inline-code line (tldr-style `git …`). */
export function isCodeBoundLine(line) {
  const t = line.trim();
  if (!t) return false;
  if (/^```/.test(t)) return true;
  // Entire line is one inline code span (common in tldr pages)
  if (/^`[^`]+`$/.test(t)) return true;
  // Indented code block line
  if (/^(?: {4}|\t)\S/.test(line)) return true;
  return false;
}

/**
 * Split markdown/asciidoc into paragraph-level chunks bound to nearest headers + code.
 * Blank lines split paragraphs, except when the next non-empty line is code
 * (fenced, sole backtick span, or indented) so examples stay with preceding prose.
 * @param {string} text
 * @param {string} origin
 * @param {string} [sourceTitle]
 * @returns {{ origin: string, content: string }[]}
 */
export function chunkDocument(text, origin, sourceTitle = origin) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  let headerStack = [sourceTitle];
  /** @type {string[]} */
  let buf = [];
  let inFence = false;

  const flush = () => {
    const content = buf.join('\n').trim();
    buf = [];
    if (!content) return;
    const prefix = `[${headerStack.join(' > ')}]`;
    chunks.push({
      origin,
      content: `${prefix}\n${content}`,
    });
  };

  const nextNonEmpty = (from) => {
    for (let i = from + 1; i < lines.length; i += 1) {
      if (lines[i].trim() !== '') return lines[i];
    }
    return null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const fence = line.match(/^```/);
    if (fence) {
      inFence = !inFence;
      buf.push(line);
      continue;
    }
    if (!inFence) {
      const h = line.match(/^(#{2,3})\s+(.+)$/) || line.match(/^(={2,3})\s+(.+)$/);
      if (h) {
        flush();
        const level = h[1].startsWith('#') ? h[1].length : h[1].length;
        headerStack = [sourceTitle, ...headerStack.slice(1, level - 1), h[2].trim()];
        continue;
      }
      if (line.trim() === '') {
        const nxt = nextNonEmpty(i);
        if (nxt && isCodeBoundLine(nxt)) {
          continue;
        }
        flush();
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return chunks;
}

/**
 * Multi-anchor assignment: floor, Δ from best, hard cap N.
 * Chunks that literally mention a taxonomy command get score at least `floor`
 * so example lines that contain `git …` still route after prose+code binding.
 * @param {number[][]} chunkVectors
 * @param {{ command: string, vector: number[] }[]} taxonomy
 * @param {{ floor?: number, delta?: number, maxAnchors?: number, chunkTexts?: string[] }} [opts]
 * @returns {{ assignments: { chunkIndex: number, commands: string[], scores: number[] }[], unrouted: number[] }}
 */
export function routeChunksToCommands(chunkVectors, taxonomy, opts = {}) {
  const floor = opts.floor ?? ROUTE_SIM_FLOOR;
  const delta = opts.delta ?? ROUTE_DELTA;
  const maxAnchors = opts.maxAnchors ?? ROUTE_MAX_ANCHORS;
  const chunkTexts = opts.chunkTexts;

  const assignments = [];
  const unrouted = [];

  for (let i = 0; i < chunkVectors.length; i += 1) {
    const text = chunkTexts?.[i] || '';
    const scores = taxonomy.map((t) => {
      let score = cosineSimilarity(chunkVectors[i], t.vector);
      if (text && commandMentionedInText(text, t.command)) {
        score = Math.max(score, floor);
      }
      return { command: t.command, score };
    });
    scores.sort((a, b) => b.score - a.score);
    const best = scores[0]?.score ?? 0;
    if (best < floor) {
      unrouted.push(i);
      continue;
    }
    const kept = scores
      .filter((s) => s.score >= floor && best - s.score <= delta)
      .slice(0, maxAnchors);
    if (!kept.length) {
      unrouted.push(i);
      continue;
    }
    assignments.push({
      chunkIndex: i,
      commands: kept.map((k) => k.command),
      scores: kept.map((k) => k.score),
    });
  }

  return { assignments, unrouted };
}

/** True when `git <name>` appears as a command token in chunk text. */
export function commandMentionedInText(text, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w-])${escaped}(?=[^\\w-]|$)`, 'i').test(text);
}

/**
 * Group routed chunks into semantic_blocks (stable sort by command).
 * @param {{ origin: string, content: string }[]} chunks
 * @param {{ chunkIndex: number, commands: string[] }[]} assignments
 */
export function assembleSemanticBlocks(chunks, assignments) {
  /** @type {Map<string, { metadata_source: string, content: string }[]>} */
  const byCmd = new Map();
  for (const a of assignments) {
    const chunk = chunks[a.chunkIndex];
    const child = { metadata_source: chunk.origin, content: chunk.content };
    for (const cmd of a.commands) {
      if (!byCmd.has(cmd)) byCmd.set(cmd, []);
      byCmd.get(cmd).push(child);
    }
  }
  return [...byCmd.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([command, blocks]) => ({ command, blocks }));
}

/**
 * Ensure every taxonomy command has a semantic_block with `-h` default first.
 * @param {{ command: string, summary?: string }[]} taxEntries
 * @param {{ command: string, blocks: { metadata_source: string, content: string }[] }[]} routedBlocks
 * @param {{ buildDefault?: typeof buildDefaultHelpBlock }} [opts]
 */
export function ensureDefaultHelpBlocks(taxEntries, routedBlocks, opts = {}) {
  const buildDefault = opts.buildDefault || buildDefaultHelpBlock;
  const rolesByCommand = opts.rolesByCommand || new Map();
  const routed = new Map(routedBlocks.map((b) => [b.command, b.blocks]));
  return taxEntries
    .map((entry) => {
      const def = buildDefault(entry);
      const rest = routed.get(entry.command) || [];
      const filtered = rest.filter((b) => b.metadata_source !== def.metadata_source);
      const roles = rolesByCommand.get(entry.command) || [];
      const goalStub = {
        metadata_source: `goal-stub/${entry.command.replace(/^git\s+/, '')}`,
        content: [
          `[goal stub > ${entry.command}]`,
          entry.summary || `Work with ${entry.command}`,
          roles.length ? `goal_roles: ${roles.join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
      return {
        command: entry.command,
        blocks: [
          { metadata_source: def.metadata_source, content: def.content },
          goalStub,
          ...filtered,
        ],
      };
    })
    .sort((a, b) => a.command.localeCompare(b.command));
}

/** Pin-worthy roles with no routed prose beyond -h / goal stub. */
export function buildGoalGapsReport(blocks, rolesByCommand) {
  const gaps = [];
  for (const b of blocks || []) {
    const roles = rolesByCommand.get(b.command) || [];
    const docBlocks = (b.blocks || []).filter(
      (x) =>
        !String(x.metadata_source || '').startsWith('git/-h/') &&
        !String(x.metadata_source || '').startsWith('goal-stub/'),
    );
    const worthy = roles.some((r) =>
      ['identity', 'authorship', 'history_bisect', 'recovery', 'remotes', 'history_search'].includes(r),
    );
    if (worthy && docBlocks.length === 0) {
      gaps.push({ command: b.command, goal_roles: roles, reason: 'no_routed_prose' });
    }
  }
  return gaps;
}

function walkFiles(dir, exts, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

function loadSourceTexts() {
  const cache = path.join(PACKAGE_ROOT, 'data', 'cache', 'sources');
  const files = [
    ...walkFiles(path.join(cache, 'progit'), ['.md', '.asciidoc', '.adoc']),
    ...walkFiles(path.join(cache, 'tldr'), ['.md']),
    ...walkFiles(path.join(cache, 'cheat'), ['.md', '.txt']),
    ...walkFiles(path.join(cache, 'man'), ['.txt', '.md']),
  ];
  const docsDir = path.join(PACKAGE_ROOT, 'data', 'catalog', 'docs');
  files.push(...walkFiles(docsDir, ['.md', '.html', '.txt']));
  return files.slice(0, 500).map((f) => ({
    origin: path.relative(PACKAGE_ROOT, f).replace(/\\/g, '/'),
    text: readFileSync(f, 'utf8'),
  }));
}

/**
 * Load checked-in git command taxonomy.
 * @param {string} [filePath]
 */
export function loadGitCommandTaxonomy(filePath = gitCommandsTaxonomyPath()) {
  if (!existsSync(filePath)) {
    throw new Error(
      `Missing git command taxonomy at ${filePath}. Run: bun run taxonomy:scrape`,
    );
  }
  const data = JSON.parse(readFileSync(filePath, 'utf8'));
  const commands = data.commands || [];
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error(`git command taxonomy is empty at ${filePath}`);
  }
  return data;
}

/**
 * @param {{
 *   embedder?: { embedMany(texts: string[]): Promise<number[][]> },
 *   outPath?: string,
 *   unroutedPath?: string,
 *   sources?: { origin: string, text: string }[],
 *   taxonomyPath?: string,
 *   floor?: number,
 *   delta?: number,
 *   maxAnchors?: number,
 *   buildDefaultHelp?: typeof buildDefaultHelpBlock,
 *   log?: (msg: string) => void,
 * }} [opts]
 */
export async function prepareSemanticBlocks(opts = {}) {
  const log = opts.log || ((m) => console.log(m));
  log(`prepare: start`);
  const taxonomy = loadGitCommandTaxonomy(opts.taxonomyPath);
  const taxEntries = taxonomy.commands.map((c) => ({
    command: c.command,
    summary: c.summary || '',
  }));

  const sources = opts.sources ?? loadSourceTexts();
  const allChunks = [];
  for (const s of sources) {
    allChunks.push(...chunkDocument(s.text, s.origin, path.basename(s.origin)));
  }
  log(`prepare: sources=${sources.length} chunks=${allChunks.length} taxonomy=${taxEntries.length}`);
  if (allChunks.length === 0) {
    allChunks.push({
      origin: 'fixture',
      content: '[fixture > status]\nShow the working tree status.\n```\ngit status\n```',
    });
  }

  const embedder = opts.embedder ?? createOpenAIEmbedder();
  const taxTexts = taxEntries.map((c) => taxonomyEmbedText(c.command, c.summary));
  const chunkTexts = allChunks.map((c) => c.content.slice(0, 8000));
  log(`prepare: embedding taxonomy (${taxTexts.length}) + chunks (${chunkTexts.length})`);
  const embedProgress = (label) => (p) => {
    log(`prepare: embed ${label} ${p.done}/${p.total}`);
  };
  const [taxVecs, chunkVecs] = await Promise.all([
    embedder.embedMany(taxTexts, { onProgress: embedProgress('taxonomy'), every: 10 }),
    embedder.embedMany(chunkTexts, { onProgress: embedProgress('chunks'), every: 25 }),
  ]);
  log(`prepare: embeddings done; routing chunks`);

  const taxonomyWithVecs = taxEntries.map((c, i) => ({
    command: c.command,
    vector: taxVecs[i],
  }));

  const { assignments, unrouted } = routeChunksToCommands(chunkVecs, taxonomyWithVecs, {
    floor: opts.floor,
    delta: opts.delta,
    maxAnchors: opts.maxAnchors,
    chunkTexts,
  });

  const routed = assembleSemanticBlocks(allChunks, assignments);
  const buildDefault = opts.buildDefaultHelp || buildDefaultHelpBlock;
  const rolesByCommand = new Map();
  try {
    const rolesPath = path.join(PACKAGE_ROOT, 'packages', 'core', 'taxonomy', 'git_commands.roles.json');
    if (existsSync(rolesPath)) {
      const rolesFile = JSON.parse(readFileSync(rolesPath, 'utf8'));
      for (const c of rolesFile.commands || []) {
        rolesByCommand.set(c.command, c.goal_roles || []);
      }
    }
  } catch {
    /* optional */
  }
  const blocks = ensureDefaultHelpBlocks(taxEntries, routed, { buildDefault, rolesByCommand });
  const parsed = SemanticBlocksFileSchema.parse(blocks);

  const outPath = opts.outPath || semanticBlocksPath();
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(parsed, null, 2)}\n`);

  const gaps = buildGoalGapsReport(parsed, rolesByCommand);
  const gapsPath = opts.goalGapsPath || path.join(path.dirname(outPath), 'goal_gaps.json');
  writeFileSync(gapsPath, `${JSON.stringify({ generated_at: new Date().toISOString(), gaps }, null, 2)}\n`);
  log(`prepare: goal_gaps=${gaps.length} → ${gapsPath}`);

  const unroutedPath = opts.unroutedPath || unroutedChunksPath();
  const unroutedRows = unrouted.map((i) => ({
    metadata_source: allChunks[i].origin,
    content: allChunks[i].content,
  }));
  mkdirSync(path.dirname(unroutedPath), { recursive: true });
  writeFileSync(
    unroutedPath,
    unroutedRows.map((r) => JSON.stringify(r)).join('\n') + (unroutedRows.length ? '\n' : ''),
  );

  const multi = assignments.filter((a) => a.commands.length > 1).length;
  const docOnly = parsed.filter((b) => b.blocks.length === 1).length;
  log(
    `prepare: chunks=${allChunks.length} routed=${assignments.length} unrouted=${unrouted.length} blocks=${parsed.length} (taxonomy=${taxEntries.length}, help-only=${docOnly}) multi_anchor=${multi}`,
  );
  if (unrouted.length) {
    const sample = unroutedRows
      .slice(0, 5)
      .map((r) => r.metadata_source)
      .join(', ');
    log(`prepare: unrouted sample origins: ${sample}${unrouted.length > 5 ? '…' : ''}`);
  }
  log(`prepare: done → ${outPath}`);

  return {
    groups: parsed.length,
    path: outPath,
    unroutedPath,
    groupsData: parsed,
    unroutedCount: unrouted.length,
  };
}

export function readSemanticBlocks(filePath = semanticBlocksPath()) {
  if (!existsSync(filePath)) return [];
  return SemanticBlocksFileSchema.parse(JSON.parse(readFileSync(filePath, 'utf8')));
}

export { prepareCacheDir };
