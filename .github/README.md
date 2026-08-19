# CI

## Workflows

| Workflow | File | Triggers | What it does |
|----------|------|----------|--------------|
| CI | [`.github/workflows/ci.yml`](workflows/ci.yml) | PRs; push to `develop` | `bun run ci` (typecheck → unit/integration → audit) with mock embeddings; cancels stale runs |
| Regression Eval | [`.github/workflows/eval-main.yml`](workflows/eval-main.yml) | PRs to `main`; manual | tests + `bun run eval:regression` (catalog regression set vs seeded DB, **real** embeddings) |
| Release | [`.github/workflows/release.yml`](workflows/release.yml) | push `main` / `v*` tags; manual | gate (typecheck → test → audit → regression → web pack/e2e) → Pages on `main`; on tags: binaries (+ smoke doctor) → GitHub Release (`SHA256SUMS`) + npm via **trusted publishing (OIDC)** |
| Web e2e | [`.github/workflows/web-e2e.yml`](workflows/web-e2e.yml) | PRs / pushes to `develop`/`main` when web/search/catalog paths change; manual | Playwright against packed playground (also runs inside the release gate) |

Catalog **EXPAND** / leaf held-out and `improve/*` merges stay **local** (`bun run expand`, then `eval:regression`) — there is no CI job that commits catalog changes.

Regression gate: `bun run eval:regression` (`tools:pipeline -- --only=evalRegression`). **eval-main** and **release** run it with **real** embeddings (`GIT_GRASP_MOCK_EMBEDDINGS=0`) so hybrid KNN can meet the 0.95 accuracy gate. The default **CI** workflow uses mock embeddings for unit/integration only. The optional LLM golden judge (`bun run eval`) looks for `common/data/eval/golden/cases.json` and exits 2 if missing — **not wired in any GitHub workflow**; use `eval:regression` for catalog gates. Pipeline scripts: [`apps/pipeline/src/README.md`](../apps/pipeline/src/README.md).

## npm trusted publishing (one-time setup)

Tag releases publish with OIDC (no `NPM_TOKEN` on the publish step). Configure once on [npmjs.com](https://www.npmjs.com):

1. Open **Packages → git-grasp → Settings → Trusted publishing** (or add trusted publisher when creating the package).
2. Publisher: **GitHub Actions**
3. Fill in exactly (case-sensitive):

| Field | Value |
|-------|-------|
| Organization or user | `NuclearManatee` |
| Repository | `git-grasp` |
| Workflow filename | `release.yml` |
| Environment name | *(leave empty)* |
| Allowed actions | `npm publish` |

4. Save. After a successful OIDC publish, optionally set **Publishing access → Require two-factor authentication and disallow tokens** and revoke old automation tokens.

Requires npm CLI ≥ 11.5.1 (Release job uses Node 24). `package.json` `repository.url` must match `https://github.com/NuclearManatee/git-grasp`.

The npm package page uses **`README.npm.md`**, copied to `README.md` on the publish runner only (repo `README.md` stays the GitHub/monorepo readme).

If npm has no `git-grasp` package yet, trusted publishing on first publish may still work once the trusted publisher row is saved; if the UI requires an existing package, run one local `npm publish` with 2FA, then add the trusted publisher for CI going forward.

## Secrets

| Secret | Used for |
|--------|----------|
| `DEEPSEEK_API_KEY` | Local pipeline / LLM stages (`prepare:goals`, `generate`, `expand`, optional golden judge) — **not** required by GitHub workflows |
| `NPM_TOKEN` | **Optional.** Only needed if CI must install private npm deps. Tag releases publish via npm **trusted publishing (OIDC)** — no publish token. |
| `PUBLIC_POSTHOG_KEY` | PostHog EU project API key (`phc_…`) baked into Pages at `web:build`. Empty/missing keeps the site snippet off |
| `RELEASE_PLATFORMS` | Optional comma-separated binary slugs for `v*` tag releases: `linux-x64`, `darwin-arm64`, `darwin-x64`, `windows-x64`. Default (unset): all four. Example without macOS: `linux-x64,windows-x64`. macOS zips bundle `common/lib/libsqlite3.dylib` (Homebrew build) so sqlite-vec works without a local `brew install sqlite`. |

Pages and GitHub Releases use the built-in `GITHUB_TOKEN` (workflow permissions).

Workflows live under `.github/`. Catalog runner: [`apps/pipeline/src/README.md`](../apps/pipeline/src/README.md). Web e2e: [`apps/web/README.md`](../apps/web/README.md).
