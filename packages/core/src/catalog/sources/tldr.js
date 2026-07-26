import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from '../../lib/paths.js';
import { SOURCE_PINS, tldrCachePath } from './pins.js';
import { normalizeExample, ALLOWED_SUBCOMMANDS } from '../../lib/validator.js';

/** Core git pages to pull from tldr when doing selective fetch. */
export const TLDR_GIT_PAGES = [
  'git',
  'git-add', 'git-am', 'git-archive', 'git-bisect', 'git-blame', 'git-branch',
  'git-checkout', 'git-cherry-pick', 'git-clean', 'git-clone', 'git-commit',
  'git-config', 'git-diff', 'git-fetch', 'git-init', 'git-log', 'git-merge',
  'git-mv', 'git-pull', 'git-push', 'git-rebase', 'git-reflog', 'git-remote',
  'git-reset', 'git-restore', 'git-revert', 'git-rm', 'git-show', 'git-stash',
  'git-status', 'git-switch', 'git-tag', 'git-worktree',
];

/**
 * Parse a tldr markdown page into examples.
 * @param {string} markdown
 * @param {string} [pageName]
 */
export function parseTldrPage(markdown, pageName = '') {
  const examples = [];
  const lines = String(markdown || '').split(/\n/);
  let pendingComment = '';
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('- ')) {
      pendingComment = line.slice(2).replace(/\.$/, '').trim();
      continue;
    }
    const code = line.match(/^`(.+)`$/);
    if (code) {
      let run = code[1].trim();
      // tldr uses {{placeholders}}
      if (/\{\{/.test(run)) {
        // Keep for later glossary; still record template
      }
      if (!/^git(\s|$)/i.test(run)) {
        pendingComment = '';
        continue;
      }
      run = run.replace(/^git/i, 'git');
      examples.push({
        run: normalizeExample(run.replace(/\{\{/g, '<').replace(/\}\}/g, '>')),
        comment: pendingComment,
        source: 'tldr',
        page: pageName,
      });
      pendingComment = '';
    }
  }
  return examples;
}

/**
 * Fetch individual tldr git pages into cache (no full archive required).
 */
export async function fetchTldrPages({
  root = PACKAGE_ROOT,
  pages = TLDR_GIT_PAGES,
  fetchImpl = globalThis.fetch,
  onPage = () => {},
} = {}) {
  const dir = tldrCachePath(root);
  mkdirSync(dir, { recursive: true });
  const all = [];
  for (const page of pages) {
    const url = `${SOURCE_PINS.tldr.baseUrl}/${page}.md`;
    const res = await fetchImpl(url);
    if (!res.ok) {
      onPage({ page, ok: false, status: res.status });
      continue;
    }
    const md = await res.text();
    const file = path.join(dir, `${page}.md`);
    writeFileSync(file, md);
    const examples = parseTldrPage(md, page);
    all.push(...examples);
    onPage({ page, ok: true, n: examples.length });
  }
  writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({ downloadedAt: new Date().toISOString(), pages }, null, 2)}\n`,
  );
  return { dir, examples: dedupePreferFirst(all) };
}

function dedupePreferFirst(items) {
  const map = new Map();
  for (const item of items) {
    const key = item.run.replace(/<[^>]+>/g, '<>');
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()];
}

export function loadTldrExamples(root = PACKAGE_ROOT) {
  const dir = tldrCachePath(root);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const all = [];
  for (const f of files) {
    const md = readFileSync(path.join(dir, f), 'utf8');
    all.push(...parseTldrPage(md, f.replace(/\.md$/, '')));
  }
  return dedupePreferFirst(all);
}

/**
 * Merge cheat-sheet + tldr pools. Cheat sheet wins on exact run conflicts.
 * @param {Array<{ run: string, comment?: string, source?: string }>} cheatSheet
 * @param {Array<{ run: string, comment?: string, source?: string }>} tldr
 */
export function mergeCommandUniverse(cheatSheet = [], tldr = []) {
  const map = new Map();
  for (const item of tldr) {
    map.set(normalizeExample(item.run), { ...item, source: item.source || 'tldr' });
  }
  for (const item of cheatSheet) {
    // CS wins
    map.set(normalizeExample(item.run), { ...item, source: 'cheat-sheet' });
  }
  return [...map.values()].filter((item) => {
    const parts = item.run.split(/\s+/);
    if (parts[0] !== 'git') return false;
    if (!parts[1] || parts[1].startsWith('-')) return true;
    return ALLOWED_SUBCOMMANDS.has(parts[1]);
  });
}
