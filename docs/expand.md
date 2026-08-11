# EXPAND

**Summary:** Circular loop — **TEST → CLASSIFY → (density | width | depth) → FILL THE GAP → TEST**. Classification fans out into a single fill step.

```mermaid
flowchart TB
  XT[TEST]
  XC[CLASSIFY]
  XFd[RETRIEVAL DENSITY]
  XFw[TAXONOMY WIDTH]
  XFh[TAXONOMY DEPTH]
  XF[FILL THE GAP]
  XT --> XC
  XC --> XFd --> XF
  XC --> XFw --> XF
  XC --> XFh --> XF
  XF --> XT
```

## Gates

- **Per-leaf held-out:** accuracy ≥ **0.95** for **2** consecutive rounds (`HELDOUT_*`), with a full query count (default 12). Thin LLM drafts do not count. After triage, the same frozen query set is re-scored.
- **Corpus leaf-rate:** at least **80%** of eligible leaves must pass held-out (`minHoldoutLeafRate`, default 0.8) **and** the regression set must be green before corpus version / promote.
- **Broadcast:** last-ditch “append miss to every leaf recipe” is **off** unless `--force-broadcast`.
- **Gap pool:** WIDTH proposals are **advisory** this release (applied=0); review and expand taxonomy manually.

## Fill-the-gap axes

| Bucket / axis | Meaning | Action |
|---------------|---------|--------|
| RETRIEVAL DENSITY | Recipe exists; search missed | Alias query onto recipe(s); FTS + re-embed |
| TAXONOMY DEPTH | Leaf too thin | Neighborhood paraphrases + re-GENERATE leaf + re-held-out |
| TAXONOMY WIDTH | No leaf covers intent | Gap pool → cluster (≥3) → scoped proposals (advisory) |

Miss triage must **not** invent `expectedId` / `correctExists` for unknown recipes (avoids false bucket-1 aliases).

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
bun run expand -- --force-broadcast  # opt-in paraphrase broadcast
bun run expand:retry -- local/holdout-failed-leaves.txt
```

## Relation to EVOLVE

**EVOLVE** builds an observe feeder (PULL → FILTER → THREAD) and, by default, chains into the same triage/actions. See [evolve.md](evolve.md).
