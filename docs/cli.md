# CLI (`apps/cli`)

Local Bun CLI for semantic Git-recipe search. Never executes Git for the user.

Lifecycle: **SEARCH** ([search.md](search.md)) + **OBSERVE** ([observe.md](observe.md)).

## Features

- Natural-language search (hybrid description KNN + FTS).
- Hits show **title + description** plus command snippet; `--verbose`, `--copy`.
- `doctor` — DB / thresholds / sqlite-vec / model cache checks.
- Telemetry off by default (`telemetry on|off|status`).

## Runtime

Depends on `@git-grasp/common/cli`. Resolves package root via `common/data` + `common/config/thresholds.json` (or `GIT_GRASP_ROOT`).

```bash
bun run cli -- "undo last commit but keep my files"
bun run doctor
bun run build:release   # zip with common/data + common/config
```

See [building-binaries.md](building-binaries.md) and the root [README](../README.md).
