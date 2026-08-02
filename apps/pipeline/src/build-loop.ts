// @ts-nocheck
/**
 * Interactive Build+Eval loop with progress logs.
 * Tunable gates/concurrency via CLI flags; structured artifacts under
 * local/build-pipeline/run_<timestamp>/.
 *
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
  setBuildLogHook,
} from '../../../common/src/build/orchestrator.ts';
import {
  BUILD_LOOP_HELP,
  parseBuildLoopArgs,
  buildLoopOptsFromResolved,
} from '../../../common/src/build/buildLoopCli.ts';
import {
  createBuildPipelineRunDir,
  createPipelineRunLogger,
} from '../../../common/src/build/pipelineRunLog.ts';
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

const parsed = parseBuildLoopArgs(process.argv.slice(2), {
  hasStaging: existsSync(buildStagingDbPath()),
});
if (parsed.help) {
  console.log(BUILD_LOOP_HELP);
  process.exit(0);
}

const { resolved } = parsed;
const fresh = resolved.fresh;
const resume = resolved.resume;

const startedAt = new Date();
let runLogger = null;
if (resolved.runLog) {
  const { runDir } = createBuildPipelineRunDir({
    startedAt,
    runDir: resolved.runDir || undefined,
  });
  runLogger = createPipelineRunLogger({
    runDir,
    startedAt,
    config: {
      argv: parsed.argv,
      ...resolved,
      stagingPath: buildStagingDbPath(),
      semanticBlocksPath: semanticBlocksPath(),
    },
  });
  setBuildLogHook((line) => runLogger.onBuildLog(line));
  console.log(`[build] run log → ${runDir}`);
  runLogger.logLine(`[build] run log → ${runDir}`);
}

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
console.log(
  `[build] gates passA>=${resolved.minPassRate} hit@display>=${resolved.minHitAtDisplayRate} judgeUtil>=${resolved.utilityThreshold}`,
);
console.log(
  `[build] loop maxIterations=${resolved.maxIterations ?? '(default/resume)'} concurrency=${resolved.concurrency} evalConcurrency=${resolved.evalConcurrency}`,
);

const loopOpts = {
  mock: false,
  wipe: false, // already wiped above when fresh
  prepare: false,
  skipGround: resume,
  ...buildLoopOptsFromResolved(resolved),
  onEvalReport: (evalResult, meta) => {
    if (runLogger) runLogger.onEvalReport(evalResult, meta);
  },
  improveArtifactsDir: (meta) =>
    runLogger ? runLogger.improveArtifactsDir(meta) : undefined,
};

let result;
try {
  result = await runBuildLoop(loopOpts);
} finally {
  setBuildLogHook(null);
}

if (runLogger) {
  const summary = runLogger.finalize(result);
  console.log(`[build] summary → ${runLogger.runDir}/summary.json ok=${summary.ok}`);
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
