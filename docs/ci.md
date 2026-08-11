# CI

## Workflows

| Workflow | File | Triggers | What it does |
|----------|------|----------|--------------|
| CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | PRs; push to `develop` | `bun run ci` (unit/integration) with mock embeddings |
| Regression Eval | [`.github/workflows/eval-main.yml`](../.github/workflows/eval-main.yml) | PRs to `main`; manual | tests + `bun run eval:regression` (catalog regression set vs seeded DB) |
| Release | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | push `main` / `v*` tags; manual | gate (test → audit → regression → web pack/e2e) → Pages on `main`; on tags: binaries (+ smoke doctor) → GitHub Release (`SHA256SUMS`) + npm (needs binaries) |
| Web e2e | [`.github/workflows/web-e2e.yml`](../.github/workflows/web-e2e.yml) | PRs / pushes touching web | Playwright against packed playground |
| Improve | [`.github/workflows/improve.yml`](../.github/workflows/improve.yml) | manual | dry-run `eval:loop` with mocks (`contents: read`; does not commit or create improve branches) |

Regression gate entrypoint: `apps/pipeline/src/eval/regression-gate.ts` (`bun run eval:regression`). CI runs it with **real** embeddings (`GIT_GRASP_MOCK_EMBEDDINGS=0`) so hybrid KNN can meet the 0.95 accuracy gate; mock embeddings are fine for unit tests only. The optional LLM golden judge (`bun run eval`) looks for `common/data/eval/golden/cases.json` and exits 2 if missing — **not wired in release CI**; use `eval:regression` for catalog gates. See [maintainer.md](maintainer.md).

## Secrets

| Secret | Used for |
|--------|----------|
| `DEEPSEEK_API_KEY` | Pipeline / LLM stages (improve, local golden judge) — not required for the regression CI gate |
| `NPM_TOKEN` | `bun publish` on `v*` tags |

Pages and GitHub Releases use the built-in `GITHUB_TOKEN` (workflow permissions).

Workflows live under `.github/`. Maintainer commands: [maintainer.md](maintainer.md).
