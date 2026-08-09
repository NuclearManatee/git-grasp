// @ts-nocheck
/**
 * Ground: parallel leaf saturation from goal_taxonomy.json.
 * Flags: --max-leaves=N --max-batches=N --skip-sandbox
 */
import { loadEnv } from '../../../../common/src/lib/env.ts';
import { existsSync } from 'node:fs';
import { runGroundStep } from '../../../../common/src/build/orchestrator.ts';
import { goalTaxonomyPath } from '../../../../common/src/lib/paths.ts';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

function flagNum(args, name) {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  if (!hit) return undefined;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) ? n : undefined;
}

const args = process.argv.slice(2);
const maxLeaves = flagNum(args, '--max-leaves');
const maxBatches = flagNum(args, '--max-batches');
const skipSandbox = args.includes('--skip-sandbox');

if (!existsSync(goalTaxonomyPath())) {
  console.error(`Missing goal taxonomy: ${goalTaxonomyPath()}`);
  console.error('Run first: bun run taxonomy:scrape && bun run taxonomy:goals');
  process.exit(1);
}

console.log('Running ground (per-leaf generate → validate → discovery checkpoint)…');
const result = await runGroundStep({
  fresh: true,
  maxLeaves,
  maxBatches,
  skipSandbox,
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
