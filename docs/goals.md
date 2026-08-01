# Goals

git-grasp is a **local-first** semantic search tool for Git recipes: natural-language intents map onto validated single- or multi-step command recipes, ranked with on-device embeddings and sqlite-vec, without running Git for the user.

## Product goals

- Answer “how do I … in Git?” with a giteveryday-style snippet plus a short usage frame.
- Keep retrieval fast on modest hardware (see [perf.md](perf.md)).
- Ship the same catalog to CLI (Bun + `bun:sqlite`) and web playground (sql.js + Transformers.js).
- Build the catalog with an LLM pipeline over authoritative sources—not hand-curated recipe encyclopedias (see root [CLAUDE.md](../CLAUDE.md)).

## Non-goals

- Not a Git GUI or wrapper that executes commands.
- Not a hosted search SaaS; the Site is marketing + offline-capable playground.
- Not Node-native CLI runtime (Bun is required for the package path).
