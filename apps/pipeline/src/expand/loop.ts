// @ts-nocheck
/**
 * Build loop: ground (optional) → held-out → improve triage → regression → corpus version.
 *
 * Flags:
 *   --fresh              wipe staging and run ground first
 *   --promote            promote staging DB to product path after regression green
 *   --force-broadcast    allow last-ditch paraphrase broadcast (off by default)
 *   --max-leaves=N       only process first N taxonomy leaves (smoke)
 *   --max-batches=N      discovery batches per leaf (default 8)
 *   --skip-sandbox       skip git sandbox (debug only)
 *   --help
 */
import { loadEnv } from '../../../../common/src/lib/env.ts';
import { existsSync, rmSync, mkdirSync } from 'node:fs';
import { runBuildLoop } from '../../../../common/src/build/orchestrator.ts';
import {
  goalTaxonomyPath,
  buildStagingDbPath,
  buildCacheDir,
} from '../../../../common/src/lib/paths.ts';

loadEnv();
delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;

function flagNum(args, name) {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  if (!hit) return undefined;
  const n = Number(hit.split('=')[1]);
  return Number.isFinite(n) ? n : undefined;
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: bun apps/pipeline/src/expand/loop.ts [flags]
  --fresh              wipe staging; run GENERATE then EXPAND
  --promote            promote staging → product DB after green regression
  --force-broadcast    last-ditch miss→all-leaf paraphrases (off by default)
  --max-leaves=N       smoke: N diverse leaves (fixture/verb spread; try 3–8)
  --max-batches=N      discovery batches per leaf (default 8; smoke: 2–5)
  --skip-sandbox       skip sandbox validation (debug)
`);
  process.exit(0);
}

const fresh = args.includes('--fresh') || !existsSync(buildStagingDbPath());
const promote = args.includes('--promote');
const forceBroadcast = args.includes('--force-broadcast');
const maxLeaves = flagNum(args, '--max-leaves');
const maxBatches = flagNum(args, '--max-batches');
const skipSandbox = args.includes('--skip-sandbox');

if (!existsSync(goalTaxonomyPath())) {
  console.error(`Missing goal taxonomy: ${goalTaxonomyPath()}`);
  console.error('Run first: bun run prepare:scrape && bun run prepare:goals');
  process.exit(1);
}

if (fresh) {
  mkdirSync(buildCacheDir(), { recursive: true });
  if (existsSync(buildStagingDbPath())) rmSync(buildStagingDbPath());
}

console.log(
  JSON.stringify(
    {
      fresh,
      promote,
      forceBroadcast,
      maxLeaves: maxLeaves ?? null,
      maxBatches: maxBatches ?? null,
      skipSandbox,
    },
    null,
    2,
  ),
);

const result = await runBuildLoop({
  fresh,
  promote,
  forceBroadcast,
  maxLeaves,
  maxBatches,
  skipSandbox,
  skipLlmPlausibility: false,
  skipJudge: false,
  skipBackTranslate: false,
});
console.log(
  JSON.stringify(
    {
      ok: result.ok,
      corpus: result.corpus,
      regression: {
        ok: result.regression?.ok,
        accuracy: result.regression?.accuracy,
        total: result.regression?.total,
      },
      holdPass: result.holdPass,
      holdRate: result.holdRate,
      minHoldoutLeafRate: result.minHoldoutLeafRate,
      holdoutLeaves: result.holdouts?.length,
      gapProposals: result.gapProposals?.length,
      gapProposalsApplied: result.gapProposalsApplied ?? 0,
      broadcastUsed: result.broadcastUsed ?? false,
    },
    null,
    2,
  ),
);
process.exit(result.ok ? 0 : 1);
