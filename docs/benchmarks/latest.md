# Latest search latency snapshot

> **Historical archive only.** Do not cite as current product performance.

**Date:** 2026-07-26  
**Catalog (historical):** corpus-era dump with **9925** intents / **342** recipes (~**7.3** intents per skill/example).  
**Current product DB:** **schema v9** (description KNN + FTS; no intent table; BGE-small). Re-bench before any public latency claim — see [perf.md](../perf.md).

## How to read

| Mode | Meaning |
|------|---------|
| **cold / warm** | Fresh CLI process each sample (reloads embedder). Warm = after discard samples (disk caches hot). |
| **sticky-warm** | One process; times search path only with model already loaded. |

Former public claim (“sub-second on a low-end device”) referred to Docker **`mid` (2 vCPU / 4GB)** (~0.6s p95 process-per-call; ~0.2s sticky) on this **intents-era** catalog. Cheap-VPS **`gate` (1 vCPU / 1GB)** process-per-call stayed ~1.2s and was **not** claimed as sub-second.

## Device matrix (default skill, p95 ms)

| Device | Profile | cold | warm | sticky-warm |
|--------|---------|-----:|-----:|------------:|
| Cheap VPS | `gate` 1 vCPU / 1GB | 1212 | 1204 | 490 |
| Low-end laptop | `mid` 2 vCPU / 4GB | 633 | 627 | 191 |
| Local host | desktop Bun | 516 | 500 | 33 |
| Tiny | `tiny` 512MB | 1231 | 1216 | 491 |

## Synthetic intent cardinality (rank only)

In-process rank projection (duplicated KNN candidates) — latency ≪1ms:

| scenario | candidates | rank p95 (ms) |
|----------|------------|--------------:|
| baseline | 50 | 0.13 |
| intents≈3 | ~21 | 0.05 |
| intents≈5 | ~34 | 0.03 |

## Regenerate (after a fresh v9 bench)

```bash
# With local/bench/results-{gate,mid,tiny,host}.json present:
bun run bench:render-latest
```

Commit this markdown (JSON under `local/bench/` is gitignored).
