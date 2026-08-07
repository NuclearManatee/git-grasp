# Architecture

```mermaid
flowchart LR
  subgraph apps [apps]
    cli[cli]
    pipeline[pipeline]
    web[web]
  end
  commonPkg["common (@git-grasp/common)"]
  localDir[local]
  pipeline --> commonPkg
  cli --> commonPkg
  web --> commonPkg
  pipeline -->|"caches / reports"| localDir
  commonPkg -->|"ships catalog DB thresholds"| commonPkg
```

## Packages

| Path | Package | Role |
|------|---------|------|
| [`common/`](../common/) | `@git-grasp/common` | DB schema, embeddings, hybrid search, seed, build/eval libraries, prompts, taxonomy, **shipped** `data/` + `config/` |
| [`apps/cli/`](../apps/cli/) | `@git-grasp/cli` | Interactive search UX |
| [`apps/pipeline/`](../apps/pipeline/) | `@git-grasp/pipeline` | Batch catalog build + seed + golden/eval loop CLIs |
| [`apps/web/`](../apps/web/) | `@git-grasp/web` | Astro site + playground |

## Data layout

| Path | Contents | Tracked? |
|------|----------|----------|
| `common/data/catalog/` | `commands.json`, `intents.jsonl`, docs mirror, glossary | yes (improve gate) |
| `common/data/eval/` | Build banks + golden cases + judge criteria. Bank rows carry `source` (`llm` now; `telemetry` later) so the gate can weight real queries without a schema change. In-build Hit@display counts exact `command_id` matches plus downward **Hit@family** (displayed child of expected) | yes |
| `common/data/git-commands.db` | Seeded schema-v6 DB | yes (improve gate) |
| `common/config/thresholds.json` | Search/display thresholds | yes |
| `local/cache/` | Sources, prepare, build staging | no |
| `local/eval/` | Eval reports / checkpoints | no |
| `local/bench/` | Perf binaries + result JSON | no |

Root detection (`GIT_GRASP_ROOT` / `common/src/lib/paths.ts`) fingerprints `common/data/` + `common/config/thresholds.json`.

## Search path

Intent KNN (`sqlite-vec`) + command FTS5 BM25 → weighted fusion → confidence-gated display. Shared implementation in `@git-grasp/common`; CLI and web are thin clients.

Display gating (`common/src/search/fusion.ts`) decouples two decisions:

- **Count 1 / 2 / 3** — relative: fused-score confidence `C = min(1, S1·(1+gap))` (missing S2 ⇒ gap 0) plus gap floors (`gapExact` / `gapNarrow`, defaults in `constants.ts`). Near-ties widen the display (orange ×3), never shrink it to a false “exact” single.
- **Abstain (red / empty)** — absolute: only when the top hit is weak on every channel (raw cosine < `abstainCosineFloor`, no BM25, no verb boost). Crowded-but-plausible lists show alternatives instead of nothing.

Optional `thresholds.json` fields: `gapExact`, `gapNarrow`, `abstainCosineFloor`. `SEARCH_ALGORITHM_VERSION` is left at **2** on this change (bumping it would reject the shipped DB meta until the next improve-cycle reseed).

## Tests

- `test/unit` — Vitest
- `test/integration` — Bun test
- `test/performance` — latency / install harnesses (`bun run bench`)
