#!/usr/bin/env bun
/**
 * Render docs/benchmarks/latest.md from local/bench/results-{gate,mid,tiny,host}.json when present.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outPath = path.join(root, 'docs', 'benchmarks', 'latest.md');
const resultsDir = path.join(root, 'local', 'bench');

const profiles = [
  { key: 'gate', label: 'Cheap VPS', detail: '`gate` 1 vCPU / 1GB' },
  { key: 'mid', label: 'Low-end laptop', detail: '`mid` 2 vCPU / 4GB' },
  { key: 'host', label: 'Local host', detail: 'desktop Bun' },
  { key: 'tiny', label: 'Tiny', detail: '`tiny` 512MB' },
];

function load(key) {
  const p = path.join(resultsDir, `results-${key}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function p95(j, mode, skill = 'default') {
  const row = (j.results || []).find((r) => r.mode === mode && r.skill === skill);
  return row ? Math.round(row.p95) : '—';
}

function syntheticBlock(j) {
  const syn = j.synthetic || j;
  const cat = syn.catalog;
  const rank = syn.rank;
  if (!cat || !rank) return null;
  return { cat, rank };
}

const loaded = Object.fromEntries(profiles.map((p) => [p.key, load(p.key)]));
const any = profiles.map((p) => loaded[p.key]).find(Boolean);
if (!any) {
  console.error('No local/bench/results-{gate,mid,tiny,host}.json found; refusing to overwrite latest.md');
  process.exit(1);
}

const synSrc = loaded.mid || any;
const syn = syntheticBlock(synSrc);
const at = (loaded.mid || any).at || new Date().toISOString();
const date = at.slice(0, 10);

const rows = profiles
  .map((p) => {
    const j = loaded[p.key];
    if (!j) return `| ${p.label} | ${p.detail} | — | — | — |`;
    return `| ${p.label} | ${p.detail} | ${p95(j, 'cold')} | ${p95(j, 'warm')} | ${p95(j, 'sticky-warm')} |`;
  })
  .join('\n');

const catalogLine = syn
  ? `**Catalog:** schema v5 — **${syn.cat.rows}** intents / **${syn.cat.examples}** recipes (~**${Number(syn.cat.intentsPerSkillExample).toFixed(1)}** intents per skill/example)`
  : '**Catalog:** (see source JSON)';

const rankTable = syn
  ? `| scenario | candidates | rank p95 (ms) |
|----------|------------|--------------:|
| baseline | ${syn.rank.baseline.candidateN} | ${syn.rank.baseline.p95.toFixed(2)} |
| intents≈3 | ~${syn.rank.intents3.candidateN} | ${syn.rank.intents3.p95.toFixed(2)} |
| intents≈5 | ~${syn.rank.intents5.candidateN} | ${syn.rank.intents5.p95.toFixed(2)} |`
  : '_No synthetic rank block in JSON._';

const md = `# Latest search latency snapshot

**Date:** ${date}  
${catalogLine}  
**Protocol:** 45 queries, MiniLM on disk, \`--synthetic --sticky\`; cold / warm = process-per-call; sticky-warm = in-process \`search()\` with model resident. See [docs/perf.md](../perf.md).

## How to read

| Mode | Meaning |
|------|---------|
| **cold / warm** | Fresh CLI process each sample (reloads MiniLM). Warm = after discard samples (disk caches hot). |
| **sticky-warm** | One process; times search path only with model already loaded. |

Public claim: **sub-second retrieval on a low-end device** refers to Docker **\`mid\` (2 vCPU / 4GB)** (~0.6s p95 process-per-call; ~0.2s sticky). Cheap-VPS **\`gate\` (1 vCPU / 1GB)** process-per-call stays ~1.2s and is **not** claimed as sub-second.

## Device matrix (default skill, p95 ms)

| Device | Profile | cold | warm | sticky-warm |
|--------|---------|-----:|-----:|------------:|
${rows}

## Synthetic intent cardinality (rank only)

In-process rank projection (duplicated KNN candidates) — latency ≪1ms:

${rankTable}

## Regenerate

\`\`\`bash
# After re-bench, with local/bench/results-{gate,mid,tiny,host}.json present:
bun run bench:render-latest
\`\`\`

Commit this markdown (JSON under \`local/bench/\` is gitignored).
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, md);
console.log('Wrote', path.relative(root, outPath));
