# Building binaries (feature / develop)

Official **GitHub Release** zips are produced only from **version tags on `main`** (`v*`) after the release gate passes. Use this guide to compile locally from `feature/*` or `develop` for smoke-testing.

## Prerequisites

- Bun ≥ 1.1 (`packageManager` in root `package.json`)
- Seeded catalog DB: `data/git-commands.db` (`bun run seed` if missing)
- `config/thresholds.json` present
- `zip` on PATH (Linux/macOS runners); Windows uses PowerShell `Compress-Archive`

## One-shot release layout

From the repo root:

```bash
bun run seed          # if DB missing
bun run build:release
```

This runs [`scripts/build-release-binary.js`](../scripts/build-release-binary.js), which:

1. `bun build --compile` → `git-help` (or `git-help.exe`)
2. Copies `data/git-commands.db` (+ `.sha256` if present) and `config/thresholds.json`
3. Zips them as `dist-release/git-help-<os>-<arch>.zip`

Unpack and run **from the extracted folder** so the binary finds `data/` and `config/` next to itself (via `process.execPath`). You can also set:

```bash
export GIT_HELP_ROOT=/path/to/extracted/folder
```

## Platform notes

| Host | Typical asset |
|------|----------------|
| Linux x64 | `git-help-linux-x64.zip` |
| macOS Apple Silicon | `git-help-darwin-arm64.zip` |
| macOS Intel | `git-help-darwin-x64.zip` |
| Windows x64 | `git-help-windows-x64.zip` |

Cross-compiling is not supported here — build on (or CI-matrix) the target OS/arch.

The embedding model still downloads on first non-mock search (Hugging Face / Xenova). Offline use needs a warmed model cache afterward.

## What does *not* publish from lower branches

- No GitHub Release upload
- No `bun publish` to npm
- No GitHub Pages deploy

Those run only from [`.github/workflows/release.yml`](../.github/workflows/release.yml) on `main` / `v*` tags after the gate (tests, golden eval with `DEEPSEEK_API_KEY`, web e2e).

## Bench-only compile

For perf Docker / local timing without the zip layout:

```bash
bun run build:cli   # → bench/git-help
```

That binary still needs `GIT_HELP_ROOT` (or cwd) pointing at a package root with `data/` + `config/thresholds.json`. Prefer `build:release` for anything resembling a user install.
