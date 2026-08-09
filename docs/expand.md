# EXPAND

**Summary:** Evolving loop over an existing catalog. Held-out (or any) queries that miss are triaged into buckets; actions improve retrieval or fill gaps. Growing regression must stay green. Accepts **synthetic or real** miss streams.

```mermaid
flowchart TB
  Q[Held-out / miss queries] --> H{Hit@10 leaf?}
  H -->|pass ×2| OK[Leaf green]
  H -->|miss| T{Triage bucket}
  T -->|1 Retrieval| A[Alias paraphrase + re-embed]
  T -->|2 Leaf gap| B[Nearby paraphrases + re-saturate]
  T -->|3 Taxonomy gap| C[Gap pool → cluster → new leaves]
  A --> H
  B --> H
  C --> G[GENERATE new leaves]
  OK --> R[Regression set]
  R -->|≥0.95| ShipReady[Ready for SHIP]
```

## Buckets

| Bucket | Meaning | Action |
|--------|---------|--------|
| 1 Retrieval | Recipe exists; search missed | Alias query onto recipe(s); FTS + re-embed |
| 2 Leaf gap | Leaf too thin | Neighborhood paraphrases + re-GENERATE leaf + re-held-out |
| 3 Taxonomy gap | No leaf covers intent | Gap pool → cluster (≥3) → scoped new leaves → GENERATE |

## Code

| Path | Role |
|------|------|
| `apps/pipeline/src/expand/loop.ts` | Full loop (optional GENERATE first via `--fresh`) |
| `apps/pipeline/src/expand/holdout-retry.ts` | Retry failed leaves |
| `common/src/expand/` | Stage facade |
| `common/src/build/leafHoldout.ts` | Hit@10 gate |
| `common/src/build/improveTriage.ts` | Buckets 1/2/3 |
| `common/src/build/regressionSet.ts` | Growing regression |
| `common/prompts/improve/` | Triage / gap-cluster |

## Run

```bash
bun run expand -- --fresh          # GENERATE then EXPAND
bun run expand                     # EXPAND on existing staging
bun run expand:retry -- local/holdout-failed-leaves.txt
```

## Relation to EVOLVE

EXPAND is implemented today. **EVOLVE** (future) will judge **OBSERVE** queries and feed the same triage/actions.
