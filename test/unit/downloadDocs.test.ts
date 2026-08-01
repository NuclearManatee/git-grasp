// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { downloadAllDocs, loadLocalDocs, pageSlug } from '../../common/src/catalog/downloadDocs.js';
import { stripHtmlToText, assertAllowlistedUrl } from '../../common/src/catalog/docs.js';

describe('downloadDocs / local docs', () => {
  it('happy: downloads via mocked fetch and loads offline', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gh-docs-'));
    const html = '<html><script>bad()</script><body>git status shows files</body></html>';
    const { pages, mirror } = await downloadAllDocs({
      root,
      urls: ['https://git-scm.com/docs/git-status'],
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        headers: { get: () => null },
        arrayBuffer: async () => Buffer.from(html),
      }),
    });
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain('git status');
    expect(pages[0].text).not.toContain('bad()');
    expect(mirror.hash).toMatch(/^[a-f0-9]{64}$/);

    const loaded = loadLocalDocs(root);
    expect(loaded[0].url).toContain('git-status');
    rmSync(root, { recursive: true, force: true });
  });

  it('negative: loadLocalDocs without download throws', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gh-docs-empty-'));
    expect(() => loadLocalDocs(root)).toThrow(/Local docs missing/);
    rmSync(root, { recursive: true, force: true });
  });

  it('fault: redirect off-allowlist throws', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gh-docs-redir-'));
    await expect(downloadAllDocs({
      root,
      urls: ['https://git-scm.com/docs/git'],
      fetchImpl: async () => ({
        status: 302,
        ok: false,
        headers: { get: (h) => (h === 'location' ? 'https://evil.com/x' : null) },
        arrayBuffer: async () => Buffer.from(''),
      }),
    })).rejects.toThrow(/allowlisted/);
    rmSync(root, { recursive: true, force: true });
  });

  it('fault: redirect loop exceeds max', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'gh-docs-loop-'));
    await expect(downloadAllDocs({
      root,
      urls: ['https://git-scm.com/docs/git'],
      fetchImpl: async () => ({
        status: 302,
        ok: false,
        headers: { get: (h) => (h === 'location' ? 'https://git-scm.com/docs/git-status' : null) },
        arrayBuffer: async () => Buffer.from(''),
      }),
    })).rejects.toThrow(/Too many redirects/);
    rmSync(root, { recursive: true, force: true });
  });

  it('edge: pageSlug sanitizes', () => {
    expect(pageSlug('https://git-scm.com/docs/git-status')).toMatch(/git-status/);
  });

  it('negative: assertAllowlistedUrl rejects http', () => {
    expect(() => assertAllowlistedUrl('http://git-scm.com/docs')).toThrow(/HTTPS/);
  });
});
