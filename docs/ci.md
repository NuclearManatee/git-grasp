# CI

## Workflows

| Workflow | File | Triggers | What it does |
|----------|------|----------|--------------|
| CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PRs; push to `develop` | `bun run ci` (typecheck → unit/integration → audit) with mock embeddings; cancels stale runs |
| Regression Eval | [`.github/workflows/eval-main.yml`](../.github/workflows/eval-main.yml) | PRs to `main`; manual | tests + `bun run eval:regression` (catalog regression set vs seeded DB, **real** embeddings) |
| Release | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | push `main` / `v*` tags; manual | gate (typecheck → test → audit → regression → web pack/e2e) → Pages on `main`; on tags: binaries (+ smoke doctor) → GitHub Release (`SHA256SUMS`) + npm (needs binaries; classic `NPM_TOKEN`) |
| Web e2e | [`.github/workflows/web-e2e.yml`](../.github/workflows/web-e2e.yml) | PRs / pushes to `develop`/`main` when web/search/catalog paths change; manual | Playwright against packed playground (also runs inside the release gate) |

Catalog **EXPAND** / leaf held-out and `improve/*` merges stay **local** (`bun run expand`, then `eval:regression`) — there is no CI job that commits catalog changes.

Regression gate: `bun run eval:regression` (`tools:pipeline -- --only=evalRegression`). **eval-main** and **release** run it with **real** embeddings (`GIT_GRASP_MOCK_EMBEDDINGS=0`) so hybrid KNN can meet the 0.95 accuracy gate. The default **CI** workflow uses mock embeddings for unit/integration only. The optional LLM golden judge (`bun run eval`) looks for `common/data/eval/golden/cases.json` and exits 2 if missing — **not wired in any GitHub workflow**; use `eval:regression` for catalog gates. Pipeline scripts: [`apps/pipeline/src/README.md`](../apps/pipeline/src/README.md).

## Secrets

| Secret | Used for |
|--------|----------|
| `DEEPSEEK_API_KEY` | Local pipeline / LLM stages (`prepare:goals`, `generate`, `expand`, optional golden judge) — **not** required by GitHub workflows |
| `NPM_TOKEN` | Classic npm auth for `bun publish` on `v*` tags (release does not use OIDC trusted publishing) |

Pages and GitHub Releases use the built-in `GITHUB_TOKEN` (workflow permissions).

Workflows live under `.github/`. Catalog runner: [`apps/pipeline/src/README.md`](../apps/pipeline/src/README.md). Web e2e: [`apps/web/README.md`](../apps/web/README.md).
