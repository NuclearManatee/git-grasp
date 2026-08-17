# Pipeline (index)

How git-grasp builds and ships its offline Git recipe catalog.

**Operator runbook:** [`apps/pipeline/src/README.md`](../apps/pipeline/src/README.md) (Anvil colocated README — steps, rollback, flags). This page is the lifecycle map for SEARCH/OBSERVE, which are not pipeline steps.

**Philosophy** ([CLAUDE.md](../CLAUDE.md)): models derive catalog **content** from `git help` + an LLM goal taxonomy. Code constrains (Zod, caps, sandbox). Hand-authored goldens are not the normal path.

Schema **v9**: `recipes` + `vec_recipes` (description embeddings) + `recipes_fts`.

```mermaid
flowchart TB
  P[PREPARE]
  G[GENERATE]
  X[EXPAND]
  S[SHIP]
  subgraph R [SEARCH]
    Rcli[CLI]
    Rweb[WEB]
  end
  O[OBSERVE]
  E[EVOLVE]
  P --> G --> X --> S --> R
  R --> O
  O -.-> E
  E -.-> X
```

**EXPAND** detail ([expand.md](expand.md)):

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

## Stage docs

| Stage | Doc | Script |
|-------|-----|--------|
| PREPARE | [prepare.md](prepare.md) | `prepare:scrape`, `prepare:goals` (shims of `tools:pipeline`) |
| GENERATE | [generate.md](generate.md) | `generate` |
| EXPAND | [expand.md](expand.md) | `expand` |
| SHIP | [ship.md](ship.md) | `ship` |
| SEARCH | [search.md](search.md) | `cli` / web |
| OBSERVE | [observe.md](observe.md) | `telemetry` |
| EVOLVE | [evolve.md](evolve.md) | `evolve` |

One Anvil script: `bun run tools:pipeline`. Layout: `apps/pipeline/src/{index.ts,commons,steps,tests,README.md}`. Shared libs still live under `common/src/build/` with stage facades in `common/src/{prepare,…,evolve}/`.

## Recipe model (shared)

Each recipe: `id`, `commands[]`, `title`, `description`, `tags`, `taxonomy_leaf`, `paraphrases[]`, provenance, validation metadata.

**Embed `description` (+ paraphrases after triage aliases).** Search never embeds raw commands.

## Parallelism

Leaves and candidates run concurrently (`LEAF_CONCURRENCY`, `CANDIDATE_CONCURRENCY`). Corpus version / SHIP is the serial choke point.
