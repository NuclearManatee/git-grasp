# Performance budget

Interactive search target: **CLI wall-time p95 &lt; 500ms** (cold + warm) when MiniLM is already on disk, measured on Docker profile **`gate`** (1 vCPU / 1GB). Cheap-VPS scenario uses the same caps.

Workflow: change → eval loop → local Docker perf (PR checklist). **No CI latency job.**

## Quick start

```bash
# Host (Bun script; Windows default)
bun run bench -- --no-compile --quick --sticky --synthetic

# Full protocol (5 discard + 50 timed, default + skill=2)
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

Queries: [`test/performance/queries.json`](../test/performance/queries.json) (30 golden + 15 stratified extras).

## Protocol

| Mode | Meaning |
|------|---------|
| **cold** | Fresh process per sample; model files on disk; includes process start + MiniLM load into RAM + search |
| **warm** | Same as cold after N discard samples (disk caches hot); still **reloads model each process** |
| **sticky-warm** | Diagnostic: one process, model resident; times `search()` only |

Invokers: `bun-script` (`bun apps/cli/bin/index.ts`) or `compiled` (`bun build --compile`). Compiled needs `LD_LIBRARY_PATH` to `onnxruntime-node` natives on Linux; on Windows compile + sharp is unreliable — use `--no-compile`.

Phases (`GIT_GRASP_BENCH=1`): checksum, config, model, embed, knn, rank.

Deep profile: `bun --cpu-prof apps/cli/bin/index.ts "…"`.

## Latency table (current catalog, schema v6 + sqlite-vec)

Human-readable snapshot (committed): **[docs/benchmarks/latest.md](benchmarks/latest.md)** (2026-07-26). After re-bench, run `bun run bench:render-latest` and commit the markdown (`local/bench/results*.json` stays gitignored).

### Docker `mid` (2 vCPU / 4GB) — low-end claim basis

| mode | skill | p95 (ms) |
|------|-------|----------|
| cold | default | ~633 |
| warm | default | ~627 |
| sticky-warm | default | ~191 |

### Docker `gate` (1 vCPU / 1GB) — cheap-VPS / authoritative process-per-call

| mode | skill | p95 (ms) |
|------|-------|----------|
| cold | default | ~1212 |
| warm | default | ~1204 |
| sticky-warm | default | ~490 |

In-process search after model load remains well under 500ms on mid; gate sticky is borderline ~490ms p95.

## Bottlenecks

1. **Per-process MiniLM ONNX session load** dominates CLI wall time (~1.1s @ 1 vCPU; ~300–400ms on a warm desktop). Product UX is one process per invocation, so cold≈warm for process-per-call.
2. Bun/CLI startup + barrel imports — mitigated by `@git-grasp/common/cli` slim entry + fast-path `bin/index.ts`.
3. Search path after model load is **well under budget** (sqlite-vec KNN + JS re-rank).
4. Skill filter: SQL hydrate `skill_level <= ?` with KNN overfetch when skill is set.

## Optimizations landed

- Slim `@git-grasp/common/cli` export surface for the CLI
- Fast bare-query path (skip commander until needed)
- Overlap model load with checksum/config
- Skill-aware `knnRecall` hydrate filter
- Model download / load status via ora (blocks until ready)
- Offline-friendly cache detection + `env.allowRemoteModels` when cached
- `GIT_GRASP_ROOT` / cwd package-root resolution for compiled binaries
- Bench harness, Docker profiles, synthetic intent projection, sticky-warm diagnostic

## Intent cardinality (3 vs 5) — recommendation

Synthetic rank-only projection (duplicated KNN candidates):

| scenario | candidates | rank p95 |
|----------|------------|----------|
| baseline | 50 | ≪1ms |
| intents≈3 | ~31 | ≪1ms |
| intents≈5 | ~52 | ≪1ms |

Catalog today: **9925** intents, **342** recipes, **~7.3 intents / skill / example**.

**Go:** keep defaults around **4–5+ intents** per skill/example. Rank cost is negligible vs MiniLM process load. Prefer sparse intents only for rare commands for **catalog quality/size**, not latency.

## Gate verdict (2026-07-26)

| Check | Result |
|-------|--------|
| In-process / sticky-warm @ mid (2/4GB) | **PASS** ~191ms p95 |
| Full CLI process-per-call @ mid | **~0.6s p95** — public “sub-second on low-end” basis |
| Full CLI process-per-call @ gate (1/1GB) | **NO-GO** for &lt;500ms (~1.2s p95) — MiniLM reload |
| Intent 3 vs 5 | **GO** (latency-neutral) |

To meet &lt;500ms for **product** CLI on cheap VPS, next options (out of this pass): resident embed worker/daemon, smaller/quantized model, or raise the cold-CLI budget (~1.5s) while keeping sticky/in-process &lt;500ms as the search-path gate.

## PR checklist (before merge to `develop`)

- [ ] `bun test` (unit + integration)
- [ ] Eval loop / golden as required by change type
- [ ] `docker compose --profile gate run --rm gate` — record results; note sticky vs process-per-call
- [ ] Re-run after catalog redesign / seed changes
- [ ] If latency numbers changed: `bun run bench:render-latest` and commit `docs/benchmarks/latest.md`

## Install bench (separate)

```bash
docker compose --profile install run --rm install
# or: bun run bench:install -- --rate 5mbit --require-tc
```

Times `bun install` + model warm under `tc` ~5mbit. Not part of the 500ms search gate.
