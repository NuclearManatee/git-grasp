#!/usr/bin/env bun
// @ts-nocheck
/**
 * EVOLVE pipeline entry: bun run evolve [--no-chain] [--llm-label] [--ship] [--catalog-version=N]
 */
import { runEvolve } from '@git-grasp/common/evolve';

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {
    noChain: args.includes('--no-chain'),
    llmLabel: args.includes('--llm-label'),
    ship: args.includes('--ship'),
    help: args.includes('--help') || args.includes('-h'),
    catalogVersion: null,
  };
  for (const a of args) {
    if (a.startsWith('--catalog-version=')) {
      opts.catalogVersion = a.slice('--catalog-version='.length);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(`Usage: bun run evolve [options]

  --no-chain              Stop after feeder (no EXPAND triage)
  --llm-label             Confirm ambiguous weak/abandon labels via LLM
  --ship                  After green version bump, promote staging → product DB
  --catalog-version=N     Require this catalog_version (refuse mixed)
  --help                  Show help

Env: GIT_GRASP_UMAMI_HOST (default http://127.0.0.1:3001),
     GIT_GRASP_UMAMI_WEBSITE_ID, GIT_GRASP_UMAMI_TOKEN or login
     GIT_GRASP_UMAMI_USERNAME / GIT_GRASP_UMAMI_PASSWORD (default admin/umami)
`);
    process.exit(0);
  }

  const result = await runEvolve({
    noChain: opts.noChain,
    llmLabel: opts.llmLabel,
    ship: opts.ship,
    catalogVersion: opts.catalogVersion,
    allowVersionBump: opts.ship,
  });

  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        refused: result.refused,
        stats: result.stats,
        feeder_train: result.feederTrain?.length,
        feeder_holdout: result.feederHoldout?.length,
      },
      null,
      2,
    ),
  );
  process.exit(result.ok || result.refused ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
