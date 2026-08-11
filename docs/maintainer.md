# Maintainer scripts

Catalog and product scripts for contributors. End users only need [Install](../README.md#install) + [Usage](../README.md#usage).

| Script | Stage |
|--------|--------|
| `bun run prepare:scrape` | PREPARE — `git help` → `git_commands.json` |
| `bun run prepare:goals` | PREPARE — LLM → `goal_taxonomy.json` |
| `bun run generate` | GENERATE — ground leaves |
| `bun run expand` | EXPAND — held-out + triage (`--fresh` also GENERATE) |
| `bun run expand:retry` | EXPAND — retry failed held-out leaves |
| `bun run evolve` | EVOLVE — PULL→FILTER→THREAD→feeder (+ EXPAND chain; `--no-chain` to stop) |
| `bun run evolve:seed-umami` | Seed local Docker Umami website for evolve e2e |
| `bun run evolve:render-latest` | Write `docs/evolve/latest.md` from `local/evolve/stats-latest.json` |
| `bun run ship` | SHIP — seed product DB |
| `bun run rebuild` | `expand -- --fresh` then `ship` |
| `bun run ship:dedupe` | Offline structural corpus merge |
| `bun test` | Unit (Vitest) + integration (Bun) |
| `bun run web:dev` / `web:build` / `web:pack` / `web:e2e` | Site + playground |
| `bun run bench` / `bench:install` | Perf harnesses |
| `bun run build:cli` / `build:release` | Compile CLI / release zip |

Use `prepare:*`, `generate`, `expand`, `ship` / `ship:dedupe` (not legacy `taxonomy:*` / `build:*` aliases).

Stage docs: [pipeline.md](pipeline.md). Pipeline needs `DEEPSEEK_API_KEY` in `.env` (or CI secrets).
