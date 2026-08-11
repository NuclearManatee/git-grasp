# Latest EVOLVE run (stats only)

**Date:** 2026-08-11  
**Catalog in:** 5 → **out:** —  

Raw events, threads, and feeder JSON stay under gitignored `local/evolve/`. This file is aggregate counts only.

## Counts

| Metric | Value |
|--------|------:|
| Pulled | 2 |
| Filtered kept | 1 |
| Filtered dropped | 1 |
| Threads | 1 |
| Feeder train | 0 |
| Feeder holdout | 1 |

## Drop reasons

| Reason | Count |
|--------|------:|
| pii_email | 1 |

## Chain

| Field | Value |
|-------|-------|
| Ran | no |
| OK | — |
| Triaged | — |
| Observe holdout hit rate | — |
| Corpus version | — |
| Shipped | no |
| Error | — |

## Regenerate

```bash
bun run evolve -- --no-chain   # or full chain
bun run evolve:render-latest
```

See [evolve.md](../evolve.md).
