import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { assertAllowlistedUrl, stripHtmlToText, DOC_MAX_REDIRECTS } from '../docs.js';
import { PACKAGE_ROOT } from '../../lib/paths.js';
import { SOURCE_PINS, cheatSheetCachePath } from './pins.js';
import { normalizeExample } from '../../lib/validator.js';

/**
 * Decode a small set of HTML entities and drop tags, keeping newlines from block structure.
 * @param {string} html
 */
export function htmlFragmentToLines(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parse shell-like git lines from giteveryday / everyday text.
 * @param {string} text
 * @returns {Array<{ run: string, comment: string, source: string }>}
 */
export function parseEverydayExamples(text) {
  const lines = String(text || '').split(/\n/);
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(?:\$\s*)?(git\s+\S.*)$/);
    if (!m) continue;
    let run = m[1].trim();
    run = run.replace(/\s*\(\d+\)\s*$/, '').trim();
    let comment = '';
    const hash = run.indexOf(' #');
    if (hash !== -1) {
      comment = run.slice(hash + 2).trim();
      run = run.slice(0, hash).trim();
    }
    if (!/^git(\s|$)/.test(run)) continue;
    if (/edit\/compile\/test|mailx|&\s|^\s*</.test(run)) continue;
    // Drop non-command narrative that slipped through
    if (run.length > 200) continue;
    out.push({
      run: normalizeExample(run),
      comment,
      source: 'cheat-sheet',
    });
  }

  // Fallback: flattened stripHtmlToText (no newlines) — recover "$ git …" tokens
  if (out.length === 0 && text && !/\n/.test(text)) {
    for (const m of String(text).matchAll(/\$\s+(git\s+[a-z][a-z0-9-]*(?:\s+[^$]+?)?)(?=\s+\$|\s+[A-Z][a-z]|$)/gi)) {
      let run = normalizeExample(m[1].replace(/\s*\(\d+\)\s*$/, ''));
      if (!/^git\s/.test(run) || run.length > 200) continue;
      if (/edit\/compile\/test|mailx/.test(run)) continue;
      out.push({ run, comment: '', source: 'cheat-sheet' });
    }
  }

  return dedupeByRun(out);
}

/**
 * Prefer <pre> / example blocks from raw HTML (newlines preserved).
 * @param {string} html
 */
export function parseEverydayFromHtml(html) {
  const out = [];
  const src = String(html || '');
  for (const m of src.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)) {
    out.push(...parseEverydayExamples(htmlFragmentToLines(m[1])));
  }
  // Also scan whole page as lines (nav noise filtered by git-prefix + length)
  out.push(...parseEverydayExamples(htmlFragmentToLines(src)));
  return dedupeByRun(out);
}

function dedupeByRun(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.run)) map.set(item.run, item);
  }
  return [...map.values()];
}

async function fetchHtmlPage(url, {
  fetchImpl = globalThis.fetch,
  maxRedirects = DOC_MAX_REDIRECTS,
  _depth = 0,
} = {}) {
  assertAllowlistedUrl(url);
  const res = await fetchImpl(url, {
    redirect: 'manual',
    headers: { Accept: 'text/html', 'User-Agent': 'git-help-catalog-builder/0.1' },
  });
  if (res.status >= 300 && res.status < 400) {
    if (_depth >= maxRedirects) throw new Error(`Too many redirects (>${maxRedirects}): ${url}`);
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`Redirect without location: ${url}`);
    const next = new URL(loc, url).href;
    assertAllowlistedUrl(next);
    return fetchHtmlPage(next, { fetchImpl, maxRedirects, _depth: _depth + 1 });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    url,
    html: buf.toString('utf8'),
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

/**
 * Fetch giteveryday (structural cheat-sheet style) into cache.
 */
export async function fetchCheatSheetSource({
  root = PACKAGE_ROOT,
  fetchImpl = globalThis.fetch,
} = {}) {
  const dir = cheatSheetCachePath(root);
  mkdirSync(dir, { recursive: true });
  const page = await fetchHtmlPage(SOURCE_PINS.cheatSheet.url, { fetchImpl });
  const examples = parseEverydayFromHtml(page.html);
  const text = stripHtmlToText(page.html);
  const file = path.join(dir, 'giteveryday.json');
  const record = {
    url: page.url,
    text,
    html: page.html,
    sha256: page.sha256,
    downloadedAt: new Date().toISOString(),
    pin: SOURCE_PINS.cheatSheet.label,
    exampleCount: examples.length,
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { file, record, examples };
}

export function loadCheatSheetExamples(root = PACKAGE_ROOT) {
  const file = path.join(cheatSheetCachePath(root), 'giteveryday.json');
  if (!existsSync(file)) return [];
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  if (rec.html) return parseEverydayFromHtml(rec.html);
  return parseEverydayExamples(rec.text);
}

export { stripHtmlToText };
