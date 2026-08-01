// @ts-nocheck
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  DOC_URLS,
  fetchDocPage,
  buildDocMirrorManifest,
  stripHtmlToText,
  assertAllowlistedUrl,
} from './docs.js';

export function docsDir(root) {
  return path.join(root, 'common', 'data', 'catalog', 'docs');
}

export function pageSlug(url) {
  const u = new URL(url);
  const raw = u.pathname.replace(/\/+/g, '_').replace(/^_|_$/g, '') || 'index';
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Download all allowlisted docs to local disk (resilient offline input for step 1).
 */
export async function downloadAllDocs({
  root,
  urls = DOC_URLS,
  fetchImpl = globalThis.fetch,
  onPage = () => {},
} = {}) {
  const dir = docsDir(root);
  mkdirSync(dir, { recursive: true });
  const pages = [];
  for (const url of urls) {
    assertAllowlistedUrl(url);
    const page = await fetchDocPage(url, { fetchImpl });
    const slug = pageSlug(url);
    const file = path.join(dir, `${slug}.json`);
    const record = {
      url: page.url,
      text: page.text,
      sha256: page.sha256,
      bytes: page.bytes,
      downloadedAt: new Date().toISOString(),
    };
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    pages.push(record);
    onPage({ url, file, bytes: page.bytes });
  }
  const mirror = buildDocMirrorManifest(pages);
  writeFileSync(
    path.join(path.dirname(dir), 'doc-mirror-manifest.json'),
    `${JSON.stringify(mirror, null, 2)}\n`,
  );
  return { pages, mirror, dir };
}

/**
 * Load previously downloaded local docs (no network).
 */
export function loadLocalDocs(root, { maxChars = 3500 } = {}) {
  const dir = docsDir(root);
  if (!existsSync(dir)) {
    throw new Error(`Local docs missing at ${dir} ÔÇö run bun run download-docs first`);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`No doc files in ${dir}`);
  return files.map((f) => {
    const rec = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    return {
      ...rec,
      text: String(rec.text || '').slice(0, maxChars),
    };
  });
}

export { DOC_URLS, stripHtmlToText, assertAllowlistedUrl, createHash };
