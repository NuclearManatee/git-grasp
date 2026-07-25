import { createHash } from 'node:crypto';

/** Pinned git-scm.com documentation pages (stable paths). */
export const DOC_URLS = [
  'https://git-scm.com/docs',
  'https://git-scm.com/docs/git',
  'https://git-scm.com/docs/gittutorial',
  'https://git-scm.com/docs/giteveryday',
  'https://git-scm.com/docs/gitworkflows',
  'https://git-scm.com/docs/git-init',
  'https://git-scm.com/docs/git-clone',
  'https://git-scm.com/docs/git-status',
  'https://git-scm.com/docs/git-diff',
  'https://git-scm.com/docs/git-add',
  'https://git-scm.com/docs/git-commit',
  'https://git-scm.com/docs/git-log',
  'https://git-scm.com/docs/git-branch',
  'https://git-scm.com/docs/git-checkout',
  'https://git-scm.com/docs/git-switch',
  'https://git-scm.com/docs/git-merge',
  'https://git-scm.com/docs/git-rebase',
  'https://git-scm.com/docs/git-reset',
  'https://git-scm.com/docs/git-restore',
  'https://git-scm.com/docs/git-revert',
  'https://git-scm.com/docs/git-stash',
  'https://git-scm.com/docs/git-pull',
  'https://git-scm.com/docs/git-push',
  'https://git-scm.com/docs/git-fetch',
  'https://git-scm.com/docs/git-remote',
  'https://git-scm.com/docs/git-tag',
  'https://git-scm.com/docs/git-config',
  'https://git-scm.com/docs/git-clean',
  'https://git-scm.com/docs/git-reflog',
  'https://git-scm.com/docs/git-cherry-pick',
  'https://git-scm.com/docs/git-bisect',
  'https://git-scm.com/docs/git-submodule',
  'https://git-scm.com/docs/git-worktree',
  'https://git-scm.com/docs/git-sparse-checkout',
  'https://git-scm.com/docs/git-grep',
  'https://git-scm.com/docs/git-blame',
  'https://git-scm.com/docs/git-show',
  'https://git-scm.com/docs/git-rm',
  'https://git-scm.com/docs/git-mv',
  'https://git-scm.com/docs/git-gc',
  'https://git-scm.com/docs/git-help',
];

const ALLOWED_HOST = 'git-scm.com';
const MAX_BYTES = 2 * 1024 * 1024;

export function assertAllowlistedUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error(`Only HTTPS allowed: ${url}`);
  if (u.hostname !== ALLOWED_HOST) throw new Error(`Host not allowlisted: ${u.hostname}`);
}

export function stripHtmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch a single allowlisted doc page as plain text.
 */
export async function fetchDocPage(url, { fetchImpl = globalThis.fetch } = {}) {
  assertAllowlistedUrl(url);
  const res = await fetchImpl(url, {
    redirect: 'manual',
    headers: { Accept: 'text/html', 'User-Agent': 'git-help-catalog-builder/0.1' },
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (!loc) throw new Error(`Redirect without location: ${url}`);
    const next = new URL(loc, url).href;
    assertAllowlistedUrl(next);
    return fetchDocPage(next, { fetchImpl });
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`Page too large: ${url}`);
  const text = stripHtmlToText(buf.toString('utf8'));
  return {
    url,
    text: text.slice(0, 3500), // token-saving per page (TPM-aware)
    sha256: createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length,
  };
}

export async function fetchAllDocs(urls = DOC_URLS, opts = {}) {
  const pages = [];
  for (const url of urls) {
    pages.push(await fetchDocPage(url, opts));
  }
  return pages;
}

export function buildDocMirrorManifest(pages) {
  return {
    pinnedAt: new Date().toISOString(),
    host: ALLOWED_HOST,
    pages: pages.map((p) => ({ url: p.url, sha256: p.sha256, bytes: p.bytes })),
    hash: createHash('sha256')
      .update(pages.map((p) => `${p.url}:${p.sha256}`).join('\n'))
      .digest('hex'),
  };
}
