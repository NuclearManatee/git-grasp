// @ts-nocheck
/**
 * Render docs/evolve/latest.md from stats (no raw queries).
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { evolveDocsLatestPath, evolveStatsJsonPath, repoRoot } from './paths.js';

/**
 * @param {import('./schemas.js').EvolveStats} [stats]
 * @param {string} [root]
 */
export function renderEvolveLatestMd(stats, root = repoRoot()) {
  let s = stats;
  if (!s) {
    const p = evolveStatsJsonPath(root);
    if (!existsSync(p)) {
      throw new Error(`No ${p}; run evolve first`);
    }
    s = JSON.parse(readFileSync(p, 'utf8'));
  }
  const date = String(s.at || '').slice(0, 10) || 'unknown';
  const drops = Object.entries(s.drop_reasons || {})
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join('\n');
  const chain = s.chain || { ran: false };
  const md = `# Latest EVOLVE run (stats only)

**Date:** ${date}  
**Catalog in:** ${s.catalog_version_in ?? '—'} → **out:** ${s.catalog_version_out ?? '—'}  

Raw events, threads, and feeder JSON stay under gitignored \`local/evolve/\`. This file is aggregate counts only.

## Counts

| Metric | Value |
|--------|------:|
| Pulled | ${s.pulled} |
| Filtered kept | ${s.filtered_kept} |
| Filtered dropped | ${s.filtered_dropped} |
| Threads | ${s.threads} |
| Feeder train | ${s.feeder_train} |
| Feeder holdout | ${s.feeder_holdout} |

## Drop reasons

| Reason | Count |
|--------|------:|
${drops || '| — | 0 |'}

## Chain

| Field | Value |
|-------|-------|
| Ran | ${chain.ran ? 'yes' : 'no'} |
| OK | ${chain.ok == null ? '—' : chain.ok ? 'yes' : 'no'} |
| Triaged | ${chain.triaged ?? '—'} |
| Observe holdout hit rate | ${chain.observe_holdout_hit_rate == null ? '—' : Number(chain.observe_holdout_hit_rate).toFixed(3)} |
| Corpus version | ${chain.corpus_version ?? '—'} |
| Shipped | ${chain.shipped ? 'yes' : 'no'} |
| Error | ${chain.error ? String(chain.error).replace(/\|/g, '/') : '—'} |

## Regenerate

\`\`\`bash
bun run evolve -- --no-chain   # or full chain
bun run evolve:render-latest
\`\`\`

See [architecture.md](../architecture.md#evolve) and [`apps/pipeline/src/README.md`](../../apps/pipeline/src/README.md).
`;
  const out = evolveDocsLatestPath(root);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, md, 'utf8');
  return out;
}

/** CLI entry for render-only */
export function mainRenderEvolveLatest() {
  const root = repoRoot();
  const out = renderEvolveLatestMd(undefined, root);
  console.log(`wrote ${out}`);
}
