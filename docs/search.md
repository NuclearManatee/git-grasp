# SEARCH

**Summary:** The product. Ask in plain language — **install the CLI** or use the **web playground**. Same hybrid retrieval either way. **No LLM at query time.**

```mermaid
flowchart TB
  Q[Query]
  E[Embed query]
  K[KNN vec_recipes]
  F[FTS recipes_fts]
  X[Fixed-blend fusion]
  D[Confidence → display 1–3]
  U[Title + description + snippet]
  Q --> E
  E --> K
  E --> F
  K --> X
  F --> X
  X --> D --> U
```

## Surfaces

| Surface | How |
|---------|-----|
| CLI | `bun add -g git-grasp` or a [release binary](../README.md#binaries-latest-github-release) — full reference [cli.md](cli.md) |
| Web | [git-grasp.cremaschi.dev](https://git-grasp.cremaschi.dev) playground — see [web.md](web.md) |

## What it does

1. Embed the query (local BGE-small).
2. Parallel description KNN + BM25 FTS.
3. Fuse scores; soft verb boost; confidence-gated display count.
4. Diversify by **structural** command fingerprint (literal vs `<placeholder>` collapse).

## Code

| Path | Role |
|------|------|
| `apps/cli` | CLI UX |
| `apps/web` | Playground (sql.js pack) |
| `common/src/search/` | Hybrid, fusion, embed, FTS |
| `common/src/cli-api.ts` | Shared search facade |

## Run

```bash
bun run cli -- "undo last commit keep files"
bun run doctor
git-grasp --json "undo last commit keep files"
```