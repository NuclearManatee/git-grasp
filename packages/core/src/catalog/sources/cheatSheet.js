import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fetchDocPage, stripHtmlToText } from '../docs.js';
import { PACKAGE_ROOT } from '../../lib/paths.js';
import { SOURCE_PINS, cheatSheetCachePath } from './pins.js';
import { normalizeExample } from '../../lib/validator.js';

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
    // Match "$ git …" or plain "git …" at line start
    const m = line.match(/^(?:\$\s*)?(git\s+\S[\s\S]*)$/);
    if (!m) continue;
    let run = m[1].trim();
    // Drop trailing footnote markers like (1)
    run = run.replace(/\s*\(\d+\)\s*$/, '').trim();
    // Inline comment after #
    let comment = '';
    const hash = run.indexOf(' #');
    if (hash !== -1) {
      comment = run.slice(hash + 2).trim();
      run = run.slice(0, hash).trim();
    }
    if (!/^git(\s|$)/.test(run)) continue;
    if (/edit\/compile\/test|mailx|&\s/.test(run)) continue;
    out.push({
      run: normalizeExample(run),
      comment,
      source: 'cheat-sheet',
    });
  }
  return dedupeByRun(out);
}

function dedupeByRun(items) {
  const map = new Map();
  for (const item of items) {
    if (!map.has(item.run)) map.set(item.run, item);
  }
  return [...map.values()];
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
  const page = await fetchDocPage(SOURCE_PINS.cheatSheet.url, { fetchImpl });
  const file = path.join(dir, 'giteveryday.json');
  const record = {
    url: page.url,
    text: page.text,
    sha256: page.sha256,
    downloadedAt: new Date().toISOString(),
    pin: SOURCE_PINS.cheatSheet.label,
  };
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return { file, record, examples: parseEverydayExamples(page.text) };
}

export function loadCheatSheetExamples(root = PACKAGE_ROOT) {
  const file = path.join(cheatSheetCachePath(root), 'giteveryday.json');
  if (!existsSync(file)) return [];
  const rec = JSON.parse(readFileSync(file, 'utf8'));
  return parseEverydayExamples(rec.text);
}

export { stripHtmlToText };
