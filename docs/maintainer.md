# Maintainer scripts

Catalog and product scripts for contributors. End users only need [Install](../README.md#install) + [Usage](../README.md#usage).

## Pipeline

| Script | Stage |
|--------|--------|
| `bun run tools:pipeline` | Anvil catalog runner (`apps/pipeline/src`) |
| `bun run prepare:scrape` | PREPARE — `git help` → `git_commands.json` |
| `bun run prepare:goals` | PREPARE — LLM → `goal_taxonomy.json` |
| `bun run generate` | GENERATE — ground leaves |
| `bun run expand` | EXPAND — held-out + triage (`--fresh` also GENERATE) |
| `bun run expand:retry` | EXPAND — retry failed held-out leaves |
| `bun run evolve` | EVOLVE — PULL→FILTER→THREAD→feeder (+ EXPAND chain; `--no-chain` to stop) |
| `bun run evolve:seed-umami` | Seed local Docker Umami website for evolve e2e |
| `bun run evolve:render-latest` | Write `docs/evolve/latest.md` from `local/evolve/stats-latest.json` |
| `bun run ship` | SHIP — seed product DB + checksum |
| `bun run rebuild` | `tools:pipeline -- --from=generate --fresh` |
| `bun run ship:dedupe` | Offline structural corpus merge |

## Eval & quality

| Script | Role |
|--------|------|
| `bun run eval:regression` | Catalog regression gate vs seeded DB (release / improve) |
| `bun run eval:loop` | Improve / advisory loop (`apps/pipeline` `loop`) |
| `bun run eval` | Optional LLM golden judge — expects `common/data/eval/golden/cases.json`; exits 2 if missing (not used in release CI) |

## Product / CI helpers

| Script | Role |
|--------|------|
| `bun run cli` | CLI entry |
| `bun run doctor` | Install / DB / schema / telemetry health |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run ci` | Local CI script (unit + integration; mock embeddings) |
| `bun test` / `test:unit` / `test:integration` | Bun test (unit + integration + pipeline) |
| `bun run test:telemetry-e2e` / `test:evolve-e2e` | Optional Umami e2e |
| `bun run web:dev` / `web:build` / `web:pack` / `web:e2e` / `web:e2e:dev` | Site + playground |
| `bun run bench` / `bench:install` / `bench:render-latest` | Perf harnesses + commit snapshot |
| `bun run build:cli` / `build:release` | Compile CLI / release zip |

Use `tools:pipeline` or the `prepare:*` / `generate` / `expand` / `ship` shims (not legacy `taxonomy:*` / `build:*` / `seed` aliases). Runbook: [apps/pipeline/src/README.md](../apps/pipeline/src/README.md).

Pipeline LLM stages need `DEEPSEEK_API_KEY` in `.env` (local only; not used by GitHub workflows). See [ci.md](ci.md).

Stage docs: [pipeline.md](pipeline.md).
