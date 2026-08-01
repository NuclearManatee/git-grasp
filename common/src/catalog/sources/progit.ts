// @ts-nocheck
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../../lib/paths.js';
import { SOURCE_PINS, progitCachePath } from './pins.js';

/**
 * Extract prose + fenced/indented git command blocks from AsciiDoc / Markdown chapters.
 * @param {string} text
 * @param {string} [chapter]
 */
export function parseProgitChapter(text, chapter = '') {
  const blocks = [];
  const src = String(text || '');

  // Fenced code blocks
  for (const m of src.matchAll(/```(?:console|shell|bash)?\n([\s\S]*?)```/g)) {
    blocks.push(...extractGitRunsFromBlock(m[1], chapter));
  }
  // AsciiDoc ---- blocks (simplified)
  for (const m of src.matchAll(/----\n([\s\S]*?)----/g)) {
    blocks.push(...extractGitRunsFromBlock(m[1], chapter));
  }
  // Indented $ git lines
  for (const line of src.split(/\n/)) {
    const m = line.match(/^\s*\$\s+(git\s+\S.*)$/);
    if (m) {
      blocks.push({
        runs: [m[1].trim().replace(/\s*\\\s*$/, '')],
        prose: '',
        chapter,
        source: 'progit',
      });
    }
  }

  return mergeAdjacent(blocks);
}

function extractGitRunsFromBlock(block, chapter) {
  const runs = [];
  for (const raw of String(block).split(/\n/)) {
    const line = raw.trim();
    const m = line.match(/^(?:\$\s*)?(git\s+\S.*)$/);
    if (!m) continue;
    let run = m[1].trim();
    if (/#$/.test(run)) run = run.replace(/\s*#.*$/, '').trim();
    if (/edit\/compile|vim |nano /.test(run)) continue;
    runs.push(run);
  }
  if (!runs.length) return [];
  return [{ runs, prose: '', chapter, source: 'progit' }];
}

function mergeAdjacent(blocks) {
  // Keep multi-run blocks as potential multi-step recipes; also emit singles
  return blocks.filter((b) => b.runs?.length);
}

/**
 * Lightweight chapter download: fetch raw book files from GitHub API contents is heavy;
 * instead fetch a curated set of chapter raw URLs from progit2.
 */
export const PROGIT_CHAPTER_PATHS = [
  'book/02-git-basics/sections/getting-a-repository.asc',
  'book/02-git-basics/sections/recording-changes.asc',
  'book/02-git-basics/sections/viewing-history.asc',
  'book/02-git-basics/sections/undoing.asc',
  'book/03-git-branching/sections/basic-branching-and-merging.asc',
  'book/03-git-branching/sections/rebasing.asc',
  'book/07-git-tools/sections/revision-selection.asc',
  'book/07-git-tools/sections/reset.asc',
  'book/07-git-tools/sections/stashing-cleaning.asc',
  'book/07-git-tools/sections/rewriting-history.asc',
];

const RAW_BASE = 'https://raw.githubusercontent.com/progit/progit2/main';

export async function fetchProgitChapters({
  root = PACKAGE_ROOT,
  chapters = PROGIT_CHAPTER_PATHS,
  fetchImpl = globalThis.fetch,
  onChapter = () => {},
} = {}) {
  const dir = progitCachePath(root);
  mkdirSync(dir, { recursive: true });
  const allBlocks = [];
  for (const rel of chapters) {
    const url = `${RAW_BASE}/${rel}`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      onChapter({ rel, ok: false, status: res.status });
      continue;
    }
    const text = await res.text();
    const file = path.join(dir, rel.replace(/\//g, '__'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
    const blocks = parseProgitChapter(text, rel);
    allBlocks.push(...blocks);
    onChapter({ rel, ok: true, n: blocks.length });
  }
  writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({
      downloadedAt: new Date().toISOString(),
      pin: SOURCE_PINS.progit.label,
      chapters,
    }, null, 2)}\n`,
  );
  return { dir, blocks: allBlocks };
}

export function loadProgitBlocks(root = PACKAGE_ROOT) {
  const dir = progitCachePath(root);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.asc') || f.includes('__'));
  const blocks = [];
  for (const f of files) {
    if (f === 'manifest.json') continue;
    const text = readFileSync(path.join(dir, f), 'utf8');
    blocks.push(...parseProgitChapter(text, f));
  }
  return blocks;
}

/**
 * Build recipe context snippets for LLM: nearby prose is omitted in ASC parse;
 * use chapter path + command runs as context string.
 */
export function progitContextForRuns(blocks, maxBlocks = 40) {
  return blocks.slice(0, maxBlocks).map((b) => ({
    chapter: b.chapter,
    runs: b.runs,
    source: 'progit',
  }));
}
