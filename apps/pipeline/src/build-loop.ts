// @ts-nocheck
/**
 * Interactive Build+Eval loop with progress logs.
 * --fresh: wipe staging/eval (keep Step −1), run ground then loop.
 * Default with no staging: same as --fresh.
 * With staging present: resume loop only (unless --fresh).
 */
import { loadEnv } from '../../../common/src/lib/env.ts';
import { existsSync } from 'node:fs';
import {
  runBuildLoop,
  wipeBuildCache,
  wipeEvalBanks,
} from '../../../common/src/build/orchestrator.ts';
import {
  buildStagingDbPath,
  semanticBlocksPath,
} from '../../../common/src/lib/paths.ts';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

if (!existsSync(semanticBlocksPath())) {
  console.error(`Missing Step −1 artifact: ${semanticBlocksPath()}`);
  console.error('Run first: bun run build:prepare');
  process.exit(1);
}

const fresh = process.argv.includes('--fresh') || !existsSync(buildStagingDbPath());
const resume = !fresh;

const maxIterArg = process.argv.find((a) => a.startsWith('--max-iterations='));
const maxIterations = maxIterArg
  ? Math.max(1, Number(maxIterArg.split('=')[1]) || 100)
  : undefined;

if (fresh) {
  console.log('[build] scraping save point (staging + eval); keeping Step −1');
  wipeBuildCache();
  wipeEvalBanks();
}

console.log(
  resume
    ? `[build] Resuming interactive loop from ${buildStagingDbPath()}`
    : `[build] Fresh ground + loop from Step −1 blocks`,
);
if (maxIterations != null) {
  console.log(`[build] maxIterations=${maxIterations}`);
}

const result = await runBuildLoop({
  mock: false,
  wipe: false, // already wiped above when fresh
  prepare: false,
  skipGround: resume,
  continueOnEvalKo: false,
  ...(maxIterations != null ? { maxIterations } : {}),
});
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
