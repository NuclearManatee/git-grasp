// @ts-nocheck
import { downloadAllDocs } from '../downloadDocs.js';
import { PACKAGE_ROOT } from '../../lib/paths.js';
import { fetchCheatSheetSource } from './cheatSheet.js';
import { fetchTldrPages } from './tldr.js';
import { fetchProgitChapters } from './progit.js';
import { buildManOracle, writeManOracle } from './manOracle.js';
import { sourcesCacheDir } from './pins.js';

/**
 * Fetch all build-time sources into gitignored cache + refresh git-scm docs + man oracle.
 */
export async function ingestAllSources({
  root = PACKAGE_ROOT,
  fetchImpl = globalThis.fetch,
  refetchDocs = false,
  useGitHelp = true,
  onProgress = () => {},
} = {}) {
  onProgress({ step: 'docs' });
  if (refetchDocs) {
    await downloadAllDocs({ root, fetchImpl, onPage: (p) => onProgress({ step: 'docs-page', ...p }) });
  } else {
    try {
      await downloadAllDocs({ root, fetchImpl, onPage: (p) => onProgress({ step: 'docs-page', ...p }) });
    } catch (e) {
      onProgress({ step: 'docs-warn', error: String(e?.message || e) });
    }
  }

  onProgress({ step: 'cheat-sheet' });
  const cheat = await fetchCheatSheetSource({ root, fetchImpl });

  onProgress({ step: 'tldr' });
  const tldr = await fetchTldrPages({
    root,
    fetchImpl,
    onPage: (p) => onProgress({ step: 'tldr-page', ...p }),
  });

  onProgress({ step: 'progit' });
  const progit = await fetchProgitChapters({
    root,
    fetchImpl,
    onChapter: (p) => onProgress({ step: 'progit-chapter', ...p }),
  });

  onProgress({ step: 'man-oracle' });
  const oracle = buildManOracle({ root, useGitHelp });
  const oraclePath = writeManOracle(oracle, root);

  return {
    cacheDir: sourcesCacheDir(root),
    cheatSheetExamples: cheat.examples,
    tldrExamples: tldr.examples,
    progitBlocks: progit.blocks,
    oraclePath,
    oracle,
  };
}
