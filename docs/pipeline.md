# Pipeline (`apps/pipeline`)

Batch app that builds and evaluates the Git catalog. Libraries live in `@git-grasp/common`; this package owns the CLI entrypoints.

## Process

1. **Taxonomy** — `taxonomy:scrape` (`git help -a` → `common/taxonomy/git_commands.json`); optional `taxonomy:pins` (LLM roles + canonical pins).
2. **Ingest** — `ingest-sources` / `download-docs` → `local/cache/sources` + `common/data/catalog/docs`.
3. **Prepare** — `build:prepare` chunks/routes sources → `local/cache/prepare`.
4. **Ground / loop** — `build:ground` / `build:loop` generate recipes + intents, sandbox-validate, write staging DB under `local/cache/build`, promote to `common/data/catalog/*`.
5. **Seed** — `seed` embeds catalog into `common/data/git-commands.db`.
6. **Eval** — `eval` (golden gate on `common/data/eval/golden`) and `eval:loop` (improve cycles); reports under `local/eval/`.

Root scripts (`bun run build:prepare`, `seed`, `eval`, …) are thin wrappers around `bun --filter @git-grasp/pipeline …`.

Catalog philosophy and git-flow rules: [CLAUDE.md](../CLAUDE.md). Architecture: [architecture.md](architecture.md).
