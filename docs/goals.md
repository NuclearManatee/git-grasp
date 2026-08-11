# Goals

git-grasp is a **local-first** semantic search tool for a finite collection of Git recipes: natural-language queries match validated single- or multi-step commands via on-device embeddings + FTS, without running Git for the user.

## Product goals

- Answer “how do I … in Git?” with title, description, and a command snippet (up to 1–3 differentiated hits).
- Keep retrieval fast on modest hardware (protocol in [perf.md](perf.md); re-bench after schema/catalog changes before citing numbers).
- Ship the same catalog to CLI (Bun + `bun:sqlite`) and web playground (sql.js + Transformers.js).
- Build the catalog top-down from `git help` + an LLM goal taxonomy, saturated per leaf with discovery curves and held-out hybrid tests—not hand-curated encyclopedias (see root [CLAUDE.md](../CLAUDE.md)).

## Non-goals

- Not a Git GUI or wrapper that executes commands.
- Not a hosted search SaaS; the site is marketing + offline-capable playground.
- Not Node-native CLI runtime (Bun is required for the package path).
- Not search-time LLM reranking (hybrid vec+BM25 only).
