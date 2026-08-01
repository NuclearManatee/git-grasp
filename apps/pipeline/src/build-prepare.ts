// @ts-nocheck
/**
 * Step −1 only: authoritative sources → durable semantic_blocks.json
 * Kept separate from ground/loop. Re-run only with --force.
 * Does not re-scrape taxonomy (run taxonomy:scrape separately once).
 */
import { loadEnv } from '../../../common/src/lib/env.ts';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { prepareSemanticBlocks } from '../../../common/src/build/prepare.ts';
import {
  semanticBlocksPath,
  unroutedChunksPath,
  prepareCacheDir,
  buildCacheDir,
} from '../../../common/src/lib/paths.ts';

loadEnv();

mkdirSync(prepareCacheDir(), { recursive: true });

// Drop legacy cluster artifact if present
const legacy = path.join(buildCacheDir(), 'raw_block_groups.json');
const legacyPrepare = path.join(prepareCacheDir(), 'raw_block_groups.json');
for (const p of [legacy, legacyPrepare]) {
  if (existsSync(p)) {
    try {
      unlinkSync(p);
      console.log(`Removed legacy Step −1 artifact ${p}`);
    } catch {
      /* */
    }
  }
}

const dest = semanticBlocksPath();
const force = process.argv.includes('--force');
if (existsSync(dest) && !force) {
  const groups = JSON.parse(
    (await import('node:fs')).readFileSync(dest, 'utf8'),
  );
  console.log(
    `Step −1 already done (${Array.isArray(groups) ? groups.length : '?'} semantic_blocks) at ${dest}`,
  );
  console.log('Pass --force to rebuild. Ground/loop will reuse this artifact.');
  process.exit(0);
}

console.log('Running Step −1 prepare (OpenAI embed + multi-anchor route)…');
const out = await prepareSemanticBlocks({
  outPath: dest,
  unroutedPath: unroutedChunksPath(),
});
console.log(
  `build:prepare wrote ${out.groups} blocks → ${out.path} (unrouted=${out.unroutedCount} → ${out.unroutedPath})`,
);
