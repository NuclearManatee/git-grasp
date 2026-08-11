# Performance budget

> **Tombstone (schema v9).** Latency tables and intent-cardinality notes below are a **2026-07-26 historical snapshot** from a pre–v9 intents-era catalog (MiniLM + skill filter). The product DB is now **schema v9** (description KNN + FTS; no intent table; BGE-small). **Do not cite these numbers as current product performance.** Re-bench, then run `bun run bench:render-latest` and replace [benchmarks/latest.md](benchmarks/latest.md).

Interactive search **target** (unchanged intent): CLI wall-time p95 &lt; 500ms (cold + warm) when the embedding model is already on disk, measured on Docker profile **`gate`** (1 vCPU / 1GB). Cheap-VPS scenario uses the same caps.

Workflow: change → eval loop → local Docker perf (PR checklist). **No CI latency job.**

## Quick start

```bash
# Host (Bun script; Windows default)
bun run bench -- --no-compile --quick --sticky --synthetic

# Full protocol (5 discard + 50 timed)
bun run bench -- --no-compile --sticky --synthetic --json --out local/bench/results-host.json

# Docker gate (1 CPU / 1GB, network none, model baked)
docker compose --profile gate build gate
docker compose --profile gate run --rm gate

# Report-only profiles
docker compose --profile mid run --rm mid
docker compose --profile tiny run --rm tiny   # 512MB — expect pressure; document failures

# Slow-network install (not part of 500ms gate)
docker compose --profile install run --rm install
```

Queries: [`test/performance/queries.json`](../test/performance/queries.json).

## Protocol

| Mode | Meaning |
|------|---------|
| **cold** | Fresh process per sample; model files on disk; includes process start + embedder load into RAM + search |
| **warm** | Same as cold after N discard samples (disk caches hot); still **reloads model each process** |
| **sticky-warm** | Diagnostic: one process, model resident; times `search()` only |

Invokers: `bun-script` (`bun apps/cli/bin/index.ts`) or `compiled` (`bun build --compile`). Compiled needs `LD_LIBRARY_PATH` to `onnxruntime-node` natives on Linux; on Windows compile + sharp is unreliable — use `--no-compile`.

Phases (`GIT_GRASP_BENCH=1`): checksum, config, model, embed, knn, rank.

Deep profile: `bun --cpu-prof apps/cli/bin/index.ts "…"`.

## Historical latency table (2026-07-26 — intents catalog, not v9)

Committed archive: **[docs/benchmarks/latest.md](benchmarks/latest.md)**. After a fresh v9 re-bench, run `bun run bench:render-latest` and commit the markdown (`local/bench/results*.json` stays gitignored).

### Docker `mid` (2 vCPU / 4GB) — then low-end claim basis

| mode | skill | p95 (ms) |
|------|-------|----------|
| cold | default | ~633 |
| warm | default | ~627 |
| sticky-warm | default | ~191 |

### Docker `gate` (1 vCPU / 1GB) — cheap-VPS / process-per-call

| mode | skill | p95 (ms) |
|------|-------|----------|
| cold | default | ~1212 |
| warm | default | ~1204 |
| sticky-warm | default | ~490 |

In-process search after model load was well under 500ms on mid; gate sticky was borderline ~490ms p95.

## Bottlenecks (still expected on v9)

1. **Per-process embedder ONNX session load** dominates CLI wall time. Product UX is one process per invocation, so cold≈warm for process-per-call.
2. Bun/CLI startup + barrel imports — mitigated by `@git-grasp/common/cli` slim entry + fast-path `bin/index.ts`.
3. Search path after model load is typically **well under budget** (sqlite-vec / JS KNN + fusion).

Skill-axis hydrate filters are **parked** in v9 (not used for retrieval).

## Optimizations landed

- Slim `@git-grasp/common/cli` export surface for the CLI
- Fast bare-query path (skip commander until needed)
- Overlap model load with checksum/config
- Model download / load status via ora (blocks until ready)
- Offline-friendly cache detection + `env.allowRemoteModels` when cached
- `GIT_GRASP_ROOT` / cwd package-root resolution for compiled binaries
- Bench harness, Docker profiles, sticky-warm diagnostic

## Intent cardinality (historical)

Synthetic rank-only projection from the intents-era catalog is archived in [benchmarks/latest.md](benchmarks/latest.md). Rank cost was negligible vs embedder process load; v9 has no intent table.

## Gate verdict (2026-07-26 — historical)

| Check | Result |
|-------|--------|
| In-process / sticky-warm @ mid (2/4GB) | **PASS** ~191ms p95 |
| Full CLI process-per-call @ mid | **~0.6s p95** — then “sub-second on low-end” basis |
| Full CLI process-per-call @ gate (1/1GB) | **NO-GO** for &lt;500ms (~1.2s p95) — embedder reload |

To meet &lt;500ms for **product** CLI on cheap VPS, options include a resident embed worker/daemon, a smaller/quantized model, or raising the cold-CLI budget (~1.5s) while keeping sticky/in-process &lt;500ms as the search-path gate.

## PR checklist (before merge to `develop`)

- [ ] `bun test` (unit + integration)
- [ ] Eval / regression as required by change type (`bun run eval:regression` for catalog gates)
- [ ] `docker compose --profile gate run --rm gate` — record results; note sticky vs process-per-call
- [ ] Re-run after catalog redesign / ship changes
- [ ] If latency numbers changed: `bun run bench:render-latest` and commit `docs/benchmarks/latest.md`

## Install bench (separate)

```bash
docker compose --profile install run --rm install
# or: bun run bench:install -- --rate 5mbit --require-tc
```

Times `bun install` + model warm under `tc` ~5mbit. Not part of the 500ms search gate.
