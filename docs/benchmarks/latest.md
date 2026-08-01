# Latest search latency snapshot

**Date:** 2026-07-26  
**Catalog:** schema v5 — **9925** intents / **342** recipes (~**7.3** intents per skill/example)  
**Protocol:** 45 queries, MiniLM on disk, `--synthetic --sticky`; cold / warm = process-per-call; sticky-warm = in-process `search()` with model resident. See [docs/perf.md](../perf.md).

## How to read

| Mode | Meaning |
|------|---------|
| **cold / warm** | Fresh CLI process each sample (reloads MiniLM). Warm = after discard samples (disk caches hot). |
| **sticky-warm** | One process; times search path only with model already loaded. |

Public claim: **sub-second retrieval on a low-end device** refers to Docker **`mid` (2 vCPU / 4GB)** (~0.6s p95 process-per-call; ~0.2s sticky). Cheap-VPS **`gate` (1 vCPU / 1GB)** process-per-call stays ~1.2s and is **not** claimed as sub-second.

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

## Regenerate

```bash
# After re-bench, with bench/results-{gate,mid,tiny,host}.json present:
bun run bench:render-latest
```

Commit this markdown (JSON under `bench/` is gitignored).
