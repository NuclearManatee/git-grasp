# CLI (`apps/cli`)

Local Bun CLI for semantic Git-recipe search. Never executes Git for the user.

## Features

- Natural-language search with skill-level filter (`set-level`).
- Snippet + usage frame output; `--verbose`, `--copy`.
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
