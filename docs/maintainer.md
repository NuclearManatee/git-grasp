# Maintainer scripts

Catalog and product scripts for contributors. End users only need [Install](../README.md#install) + [Usage](../README.md#usage).

`docs/layout.md` was retired: browsing lives in the root [README](../README.md) and app READMEs; this page is the operator script runbook. Branch policy: [git-flow.md](git-flow.md). Workflows: [ci.md](ci.md).

## Daily dev

| Script | Role |
|--------|------|
| `bun run cli` / `doctor` | CLI entry / install, DB, schema, telemetry health |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` / `test:unit` / `test:integration` | Bun test (unit + integration + pipeline) |
| `bun run ship` | SHIP — seed product DB + checksum (if missing) |

Pipeline stages (`prepare:*`, `generate`, `expand`, `evolve`, `ship`) live in [`apps/pipeline/src/README.md`](../apps/pipeline/src/README.md). Web: [`apps/web/README.md`](../apps/web/README.md).

## Local CI mirror

Matches GitHub Actions **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)):

```bash
bun run ci
```

[`common/scripts/ci.ts`](../common/scripts/ci.ts) runs, fail-fast: typecheck → `test:coverage` → `test:rest` → [`ci-audit.ts`](../common/scripts/ci-audit.ts). Mock embeddings (`GIT_GRASP_MOCK_EMBEDDINGS=1`). Install stays outside this script (`bun install --frozen-lockfile`).

Shortcut that runs the same gate and prints the next maintainer steps:

```bash
bun run preflight
```

## Pre-merge to main

Same catalog gate as **eval-main** / **release**:

```bash
bun run eval:regression
```

Uses **real** embeddings (`GIT_GRASP_MOCK_EMBEDDINGS=0`). Catalog EXPAND / leaf held-out stay local — Actions never commits catalog changes. See [git-flow.md](git-flow.md).

## Pre-release / tag

Official GitHub Release zips and npm publish run only from **`v*` tags on `main`**. Local smoke:

```bash
bun run web:e2e
bun run build:release
```

Checklist before tagging `v0.1.0` (must match `package.json` version):

1. `develop` merged to `main` after CI + regression are green.
2. Repo secret `NPM_TOKEN` is set (classic npm token; release does not use OIDC).
3. Push tag `v0.1.0` on `main` → binaries (4 platforms + smoke `doctor`) → GitHub Release (`SHA256SUMS`) + `bun publish`.

Binaries: [building-binaries.md](building-binaries.md). Workflows: [ci.md](ci.md).

## First GitHub publish

Repo URL: `https://github.com/cremaschi/git-grasp` (public). Default integration branch: **`develop`**.

```bash
gh auth login
gh repo create cremaschi/git-grasp --public --source=. --remote=origin
git push -u origin develop
git push -u origin improve/catalog-ays-llm-band improve/catalog-recipes-v5 improve/catalog-ux-v2 improve/usage-confidence-eval
git push -u origin legacy/v8
# defer until release-ready (push main triggers Release gate + GitHub Pages):
git push -u origin main
```

Do not push stale `feature/*` branches. After the first `develop` push, confirm the **CI** workflow is green before pushing `main`.

GitHub settings (once the repo exists):

- Default branch: `develop`
- Pages: GitHub Actions source; custom domain `git-grasp.cremaschi.dev`
- Secret `NPM_TOKEN` before the first `v*` tag
- Branch protection (recommended): `develop` requires CI; `main` requires PR + Regression Eval

## Secrets

| Secret | Where | Used for |
|--------|-------|----------|
| `DEEPSEEK_API_KEY` | Local `.env` only | Pipeline / LLM stages — **not** required by GitHub workflows |
| `NPM_TOKEN` | GitHub Actions secret | `bun publish` on `v*` tags |
| `GITHUB_TOKEN` | Built-in | Pages deploy and GitHub Releases |

Pages and Releases use workflow `permissions` on `GITHUB_TOKEN`. Full table: [ci.md](ci.md).

## Other product scripts

| Script | Role |
|--------|------|
| `bun run eval` | Optional LLM golden judge — expects `common/data/eval/golden/cases.json`; exits 2 if missing (not in CI) |
| `bun run eval:loop` | Improve / advisory loop |
| `bun run test:telemetry-e2e` / `test:evolve-e2e` | Optional local Docker PostHog e2e (skips if `:8010` is down) |
| `bun run web:dev` / `web:build` / `web:pack` | Site + playground |
| `bun run bench` / `bench:install` / `bench:render-latest` | Perf harnesses + commit snapshot |
| `bun run build:cli` | Compile CLI into `local/bench/` (not a release zip) |
