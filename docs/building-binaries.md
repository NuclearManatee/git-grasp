# Building binaries (feature / develop)

Official **GitHub Release** zips are produced only from **version tags on `main`** (`v*`) after the release gate passes. Use this guide to compile locally from `feature/*` or `develop` for smoke-testing.

## Prerequisites

- Bun ≥ 1.1 (`packageManager` in root `package.json`)
- Seeded catalog DB: `common/data/git-commands.db` **and** `git-commands.db.sha256` (`bun run seed` if missing — build fails without the checksum)
- `common/config/thresholds.json` present
- `common/data/catalog/recipes.latest.json` present (catalog identity)
- Root `package.json` (copied into the zip for version identity)
- `zip` on PATH (Linux/macOS runners); Windows uses PowerShell `Compress-Archive`

## One-shot release layout

From the repo root:

```bash
bun run seed          # if DB / .sha256 missing
bun run build:release
```

This runs [`apps/cli/scripts/build-release-binary.ts`](../apps/cli/scripts/build-release-binary.ts), which:

1. `bun build --compile` → `git-grasp` (or `git-grasp.exe`)
2. Copies into the stage:
   - root `package.json`
   - `common/data/git-commands.db` + **required** `.sha256`
   - `common/data/catalog/recipes.latest.json`
   - `common/config/thresholds.json`
3. Zips them as `dist-release/git-grasp-<os>-<arch>.zip`

### Install layout (required)

```text
extracted/
  git-grasp          # or git-grasp.exe on Windows
  package.json
  common/
    data/
      git-commands.db
      git-commands.db.sha256
      catalog/recipes.latest.json
    config/thresholds.json
```

Unpack and run **from the extracted folder** so the binary finds `common/` next to itself (via `process.execPath`). You can also set:

```bash
export GIT_GRASP_ROOT=/path/to/extracted/folder
```

Then: `./git-grasp doctor` / `./git-grasp init` (Windows: `.\git-grasp.exe …`).

## Platform notes

| Host | Typical asset |
|------|----------------|
| Linux x64 | `git-grasp-linux-x64.zip` |
| macOS Apple Silicon | `git-grasp-darwin-arm64.zip` |
| macOS Intel | `git-grasp-darwin-x64.zip` |
| Windows x64 | `git-grasp-windows-x64.zip` |

Cross-compiling is not supported here — build on (or CI-matrix) the target OS/arch.

Release CI smokes each zip (`unzip` + `doctor` with mock embeddings) and attaches `SHA256SUMS` to the GitHub Release. `npm-publish` waits on successful `binaries`.

The embedding model still downloads on first non-mock search (Hugging Face / Xenova), or via `git-grasp init`. Offline use needs a warmed model cache afterward.

## What does *not* publish from lower branches

- No GitHub Release upload
- No `bun publish` to npm
- No GitHub Pages deploy

Those run only from [`.github/workflows/release.yml`](../.github/workflows/release.yml) on `main` / `v*` tags after the gate (tests, **regression** eval, web e2e). See [ci.md](ci.md).

## Bench-only compile

For perf Docker / local timing without the zip layout:

```bash
bun run build:cli   # → local/bench/git-grasp
```

That binary still needs `GIT_GRASP_ROOT` (or cwd) pointing at a package root with `common/data/` + `common/config/thresholds.json`. Prefer `build:release` for anything resembling a user install.
