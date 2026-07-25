# Performance budget

Interactive search target: **CLI wall-time p95 &lt; 500ms** (cold + warm) when MiniLM is already on disk, measured on Docker profile **`gate`** (1 vCPU / 1GB). Cheap-VPS scenario uses the same caps.

Workflow: change → eval loop → local Docker perf (PR checklist). **No CI latency job.**

## Quick start

```bash
# Host (Bun script; Windows default)
bun run bench -- --no-compile --quick --sticky --synthetic

# Full protocol (5 discard + 50 timed, default + skill=2)
bun run bench -- --no-compile --sticky --synthetic --json --out bench/results-host.json

# Docker gate (1 CPU / 1GB, network none, model baked)
docker compose --profile gate build gate
docker compose --profile gate run --rm gate

# Report-only profiles
docker compose --profile mid run --rm mid
docker compose --profile tiny run --rm tiny   # 512MB — expect pressure; document failures

# Slow-network install (not part of 500ms gate)
docker compose --profile install run --rm install
```

Queries: [`bench/queries.json`](../bench/queries.json) (30 golden + 15 stratified extras).

## Protocol

| Mode | Meaning |
|------|---------|
| **cold** | Fresh process per sample; model files on disk; includes process start + MiniLM load into RAM + search |
| **warm** | Same as cold after N discard samples (disk caches hot); still **reloads model each process** |
| **sticky-warm** | Diagnostic: one process, model resident; times `search()` only |

Invokers: `bun-script` (`bun apps/cli/bin/index.js`) or `compiled` (`bun build --compile`). Compiled needs `LD_LIBRARY_PATH` to `onnxruntime-node` natives on Linux; on Windows compile + sharp is unreliable — use `--no-compile`.

Phases (`GIT_HELP_BENCH=1`): checksum, config, model, embed, knn, rank.

Deep profile: `bun --cpu-prof apps/cli/bin/index.js "…"`.

## Latency table (current catalog, schema v4 + sqlite-vec)

### Before (host, quick, early harness)

Desktop Windows, Bun 1.3.14, `bun-script`, 5 samples, real MiniLM:

| mode | skill | p50 (ms) | p95 (ms) | gate |
|------|-------|----------|----------|------|
| cold | default | 467 | 519 | FAIL |
| warm | default | 482 | 492 | PASS |
| cold | 2 | 484 | 496 | PASS |
| warm | 2 | 471 | 475 | PASS |

### After opts (host, fuller run — noisy)

Same machine under load often **fails** (~600–1300ms p95). Treat host as advisory; **Docker `gate` is authoritative.**

### Docker `gate` (1 vCPU / 1GB) — authoritative

Bun 1.2.23, compiled CLI, 50 iters, model baked, `--network none`:

| mode | skill | p50 (ms) | p95 (ms) | gate |
|------|-------|----------|----------|------|
| cold | default | 1135 | 1257 | FAIL |
| warm | default | 1132 | 1213 | FAIL |
| cold | 2 | 1138 | 1199 | FAIL |
| warm | 2 | 1134 | 1199 | FAIL |

In-process breakdown on gate (model already loaded in that process): **~25–75ms** total (checksum ~13ms, knn ~5–55ms, embed ~5ms, rank ≪1ms).

## Bottlenecks

1. **Per-process MiniLM ONNX session load** dominates CLI wall time (~1.1s @ 1 vCPU; ~300–400ms on a warm desktop). Product UX is one process per invocation, so cold≈warm for process-per-call.
2. Bun/CLI startup + barrel imports — mitigated by `@git-help/core/cli` slim entry + fast-path `bin/index.js`.
3. Search path after model load is **well under budget** (sqlite-vec KNN + JS re-rank).
4. Skill filter: SQL hydrate `skill_level <= ?` with KNN overfetch when skill is set.

## Optimizations landed

- Slim `@git-help/core/cli` export surface for the CLI
- Fast bare-query path (skip commander until needed)
- Overlap model load with checksum/config
- Skill-aware `knnRecall` hydrate filter
- Model download / load status via ora (blocks until ready)
- Offline-friendly cache detection + `env.allowRemoteModels` when cached
- `GIT_HELP_ROOT` / cwd package-root resolution for compiled binaries
- Bench harness, Docker profiles, synthetic intent projection, sticky-warm diagnostic

## Intent cardinality (3 vs 5) — recommendation

Synthetic rank-only projection (duplicated KNN candidates):

| scenario | candidates | rank p95 |
|----------|------------|----------|
| baseline | 50 | ≪1ms |
| intents≈3 | ~31 | ≪1ms |
| intents≈5 | ~52 | ≪1ms |

Catalog today: **6414 rows**, ~334 examples, **~4.8 intents / skill / example**.

**Go:** keep defaults around **4–5 intents** per skill/example. Rank cost is negligible vs MiniLM process load. Prefer sparse intents only for rare commands for **catalog quality/size**, not latency.

## Gate verdict (2026-07-25)

| Check | Result |
|-------|--------|
| In-process / sticky-warm search | **PASS** ≪500ms |
| Full CLI process-per-call @ 1vCPU/1GB | **NO-GO** (~1.1–1.3s p95) — MiniLM reload |
| Intent 3 vs 5 | **GO** for 5 (latency-neutral) |

To meet &lt;500ms for **product** CLI on low-end hardware, next options (out of this pass): resident embed worker/daemon, smaller/quantized model, or raise the cold-CLI budget (~1.5s) while keeping sticky/in-process &lt;500ms as the search-path gate.

## PR checklist (before merge to `develop`)

- [ ] `bun test` (unit + integration)
- [ ] Eval loop / golden as required by change type
- [ ] `docker compose --profile gate run --rm gate` — record results; note sticky vs process-per-call
- [ ] Re-run after catalog redesign / seed changes

## Install bench (separate)

```bash
docker compose --profile install run --rm install
# or: bun run bench:install -- --rate 5mbit --require-tc
```

Times `bun install` + model warm under `tc` ~5mbit. Not part of the 500ms search gate.
