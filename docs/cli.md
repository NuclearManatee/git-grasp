# CLI (`apps/cli`)

Local Bun CLI for semantic Git-recipe search. Never executes Git for the user.

Lifecycle: **SEARCH** ([search.md](search.md)) + **OBSERVE** ([observe.md](observe.md)).

Short “common path” examples live in the root [README Usage](../README.md#usage). This page is the full reference. Copy and chalk styling: [cli-ux.md](cli-ux.md). The [web playground](../apps/web/README.md) mirrors search chrome (`formatSearchResult`) and shows `MSG.telemetry.on` on Start; full command surface (doctor, update-check, completion, …) remains CLI-only.

## Install

Requires **Bun ≥ 1.1**.

```bash
bun add -g git-grasp
# or from a clone:
bun install && bun run ship && bun link
```

Release binaries: [building-binaries.md](building-binaries.md). Package root resolution: `GIT_GRASP_ROOT`, or the directory containing `common/data` + `common/config/thresholds.json` (compiled binary dir / cwd / walk-up).

## Commands

| Command | Purpose |
|---------|---------|
| `git-grasp "<query>"` | Default search (fast path) |
| `git-grasp search [query…]` | Same search via Commander |
| `git-grasp doctor` | Diagnose DB, model, sqlite-vec, config |
| `git-grasp init` | Doctor checks + warm embedding model |
| `git-grasp config show\|path` | Print resolved config JSON or file path |
| `git-grasp telemetry on\|off\|status` | Opt-in cookieless analytics (default off) |
| `git-grasp update-check on\|off\|status` | Opt-in npm update notices (default off) |
| `git-grasp set-level <level>` | **Deprecated/parked** — stores skill preference; **no retrieval effect in schema v9** |
| `git-grasp completion <shell>` | Print completion script (`bash\|zsh\|fish\|powershell`) |
| `git-grasp help` | Help |
| `git-grasp -V` / `--version` | App + catalog identity |

## Search flags

| Flag | Meaning |
|------|---------|
| `-v, --verbose` | Confidence / channel scores |
| `-c, --copy` | Copy winning example to clipboard |
| `--json` | Machine-readable JSON on stdout only |
| `-q, --quiet` | No spinner; skip telemetry invite |
| `-h, --help` | Help |
| `-V, --version` | Version report |

**stdin:** if there is no query argument and stdin is not a TTY, the piped text is used as the query.

```bash
echo "undo last commit keep files" | git-grasp
git-grasp --json "create a branch"
```

## Version identity

`--version` / doctor print:

```text
git-grasp 0.1.0
catalog v5 (941 recipes) · schema v9 · db abcdef012345
```

Catalog version comes from `common/data/catalog/recipes.latest.json` (also stamped into DB meta as `corpus_version` on seed).

## Config

File: platform user config dir (`%APPDATA%/git-grasp/config.json` on Windows; `~/.config/git-grasp/config.json` on Linux/macOS). Mode/ACL tightened on write.

| Field | Default | Meaning |
|-------|---------|---------|
| `schemaVersion` | `4` | Config schema |
| `skillLevel` | `null` | Parked preference (no retrieval effect in v9) |
| `telemetry` | `null` | `true` / `false` / unset |
| `telemetryInvite` | `pending` | Soft invite state |
| `updateCheck` | `null` | `true` enables npm ping |

```bash
git-grasp config show
git-grasp config path
```

## Update check (npm)

Opt-in. When enabled, after a successful search (and on `doctor` / `update-check status`) the CLI may GET `https://registry.npmjs.org/git-grasp/latest` (≈2.5s timeout). Results cache 24h under the user cache dir (`update-check.json`). Failures are silent. Hard off: `GIT_GRASP_UPDATE_CHECK=0`.

When a newer release is found, a **yellow** notice is printed on stderr (whole line, including the install command).

```bash
git-grasp update-check on
git-grasp update-check status
```

## Help

Bare `git-grasp` / `--help` opens with a short Common commands block (search, doctor, init, config, telemetry, update-check, completion). Voice and chalk rules: [cli-ux.md](cli-ux.md). **V1 product output is chalk-only** (no emoji unless `GIT_GRASP_EMOJI=1`).

## Completions

```bash
eval "$(git-grasp completion bash)"
# zsh: eval "$(git-grasp completion zsh)"
# fish: git-grasp completion fish > ~/.config/fish/completions/git-grasp.fish
# PowerShell: git-grasp completion powershell | Out-String | Invoke-Expression
```

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Generic error |
| `2` | DB integrity / schema version mismatch (`INTEGRITY` / `VERSION`) |
| `3` | Config error (`CONFIG` / `CONFIG_INSECURE`) |
| `5` | Catalog/search version mismatch when distinguished from integrity (`VERSION`) |

`--json` search mode skips telemetry invite/track (see [observe.md](observe.md)).

## Environment

| Variable | Role |
|----------|------|
| `GIT_GRASP_ROOT` | Force package root |
| `GIT_GRASP_MOCK_EMBEDDINGS=1` | Deterministic mock embeddings |
| `GIT_GRASP_TELEMETRY=0` / `DO_NOT_TRACK=1` | Hard-off telemetry (refuse enable + no-op send) |
| `GIT_GRASP_UPDATE_CHECK=0` | Hard-off npm update check |
| `GIT_GRASP_INSTALL=binary\|bun` | Hint for update-notice install copy |
| `GIT_GRASP_BENCH=1` | Print search phase timings on stderr |
| `NO_COLOR` | Disable chalk colors when set |
| `GIT_GRASP_EMOJI=1` | Opt-in closed-set emoji glyphs (off by default in V1) |
| `GIT_GRASP_NO_EMOJI=1` | Hard-off emoji even if `GIT_GRASP_EMOJI=1` |
| `GIT_GRASP_POSTHOG_HOST` / `GIT_GRASP_POSTHOG_KEY` | Override baked PostHog EU ingest defaults (empty key disables send). Docker e2e uses `http://127.0.0.1:8010` |

## Runtime notes

- Depends on `@git-grasp/common/cli`.
- Offline after install + seed; embedding model downloads on first real search (or `init`).
- Telemetry: [observe.md](observe.md). Search algorithm: [search.md](search.md).

```bash
bun run cli -- "undo last commit but keep my files"
bun run doctor
bun run build:release
```
