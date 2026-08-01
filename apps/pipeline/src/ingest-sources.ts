#!/usr/bin/env bun
// @ts-nocheck
import { ingestAllSources } from '../../../common/src/catalog/sources/ingest.js';
import { PACKAGE_ROOT } from '../../../common/src/lib/paths.js';

const refetchDocs = process.argv.includes('--refetch-docs');

const result = await ingestAllSources({
  root: PACKAGE_ROOT,
  refetchDocs,
  onProgress: (p) => {
    if (p.step === 'docs-page') console.log('  doc', p.url);
    else if (p.step === 'tldr-page') console.log('  tldr', p.page, p.ok ? p.n : p.status);
    else if (p.step === 'progit-chapter') console.log('  progit', p.rel, p.ok ? p.n : p.status);
    else console.log('ÔÇª', p.step);
  },
});

console.log('Cache:', result.cacheDir);
console.log('Cheat sheet examples:', result.cheatSheetExamples.length);
console.log('tldr examples:', result.tldrExamples.length);
console.log('Pro Git blocks:', result.progitBlocks.length);
console.log('Man oracle:', result.oraclePath);
