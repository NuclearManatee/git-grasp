# git-grasp

Local-first CLI for **semantic search** of Git recipes. Natural-language intents map 1:N onto validated recipes (single- or multi-step), tagged with skill levels (`non-technical` → `expert`) and matched with on-device embeddings + **sqlite-vec** KNN recall. Answers show a giteveryday-style command snippet (inline comments) plus a short **usage** frame. The CLI never runs Git for you.

Site: [git-grasp.cremaschi.dev](https://git-grasp.cremaschi.dev)

## Performance

Sub-second retrieval on a low-end laptop (Docker 2 vCPU / 4GB). Latest numbers: [docs/benchmarks/latest.md](docs/benchmarks/latest.md). Protocol and Docker profiles: [docs/perf.md](docs/perf.md).

## Monorepo

Bun workspaces:

| Package | Role |
|---------|------|
| `@git-grasp/core` | Schema v6 (`commands` + `intents` + `vec_intents` + `commands_fts`), MiniLM embeddings, hybrid search, seed/search facades |
| `@git-grasp/cli` | CLI UX |
| `@git-grasp/seeding` | Catalog → DB |
| `@git-grasp/eval` | Golden / loop eval |
| `@git-grasp/web` | Astro marketing site + in-browser Xterm playground |

Shared seeds and search live in `packages/core`. CLI and web are views only.

## Install

Requires **Bun ≥ 1.1** for the package install path. Runtime is Bun (`bun:sqlite`); this is not a Node-native CLI.

### Bun (npm registry)

```bash
bun add -g git-grasp
git-grasp "undo last commit but keep my files"
```

From a clone (dev):

```bash
bun install   # uses bun.lock
# optional: GIT_GRASP_SKIP_POSTINSTALL=1
bun run seed
bun link      # once → `git-grasp` on PATH
```

Postinstall smoke-loads the platform `sqlite-vec` native. Embedding model downloads on first non-mock embed.

### Binaries (latest GitHub Release)

Unzip and run from the extracted folder (ships `data/` + `config/` beside the binary):

| Platform | Download |
|----------|----------|
| Linux x64 | https://github.com/cremaschi/git-grasp/releases/latest/download/git-grasp-linux-x64.zip |
| macOS Apple Silicon | https://github.com/cremaschi/git-grasp/releases/latest/download/git-grasp-darwin-arm64.zip |
| macOS Intel | https://github.com/cremaschi/git-grasp/releases/latest/download/git-grasp-darwin-x64.zip |
| Windows x64 | https://github.com/cremaschi/git-grasp/releases/latest/download/git-grasp-windows-x64.zip |

Building from `feature/*` / `develop`: **[docs/building-binaries.md](docs/building-binaries.md)**.

## Usage

```bash
git-grasp "undo last commit but keep my files"
git-grasp search "create a branch" --verbose
git-grasp set-level beginner
git-grasp telemetry status
git-grasp doctor
```

`set-level` restricts results to **at most** that skill. Flags: `--verbose`, `--copy`.

Offline after install + seed (and model warm). Maintainer / CI features need `DEEPSEEK_API_KEY` in `.env` or GitHub Actions secrets.

## Privacy / telemetry

CLI analytics are **off by default** (cookieless Umami, same property as the Site when opted in).

```bash
git-grasp telemetry on|off|status
```

Soft invite on first interactive search (Y/n / don’t ask again). Hard off: `DO_NOT_TRACK=1` or `GIT_GRASP_TELEMETRY=0`. Events: `cli_opt_in`, `cli_search`. Overrides for tests/self-host: `GIT_GRASP_UMAMI_HOST`, `GIT_GRASP_UMAMI_WEBSITE_ID`. Details: [Privacy & legal](https://git-grasp.cremaschi.dev/privacy).

Local Umami e2e (optional):

```bash
docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
bun run test:telemetry-e2e
```

## Maintainer scripts

| Script | Purpose |
|--------|---------|
| `bun run rebuild` | Full catalog build loop + seed DB (`build:loop`) |
| `bun run taxonomy:scrape` | One-shot `git help -a` → `git_commands.json` |
| `bun run taxonomy:pins` | LLM passes A–D → `git_commands.roles.json` + `canonical_pins.json` |
| `bun run build:prepare` | Step −1 source scrape into cache |
| `bun run build:ground` | Ground catalog from prepare artifacts |
| `bun run build:loop` | Interactive build + eval loop |
| `bun run ingest-sources` | Fetch cheat sheet / tldr / Pro Git + man oracle into `data/cache/` (gitignored) |
| `bun run seed` | Embed intents → `data/git-commands.db` (schema v6 + vec0) |
| `bun test` | Unit (Vitest) + integration (Bun) |
| `bun run eval` | Golden eval |
| `bun run eval:loop` | 5 cycles then final gate |
| `bun run web:dev` | Astro site (landing + playground) |
| `bun run web:build` | Static build → `apps/web/dist` |
| `bun run web:pack` | Export `apps/web/public/catalog/web-catalog.db` from seeded DB |
| `bun run web:e2e` | Playwright a11y + tracking (preview server) |
| `bun run bench` | Search latency harness (see [docs/perf.md](docs/perf.md)) |
| `bun run bench:install` | Slow-network install timing |
| `bun run build:cli` | `bun build --compile` → `bench/git-grasp` |
| `bun run build:release` | Compile + zip release layout → `dist-release/` |

Perf budget / Docker profiles: **[docs/perf.md](docs/perf.md)**.

## Architecture notes

- Schema v6: `commands` + `intents` (skill-tagged query text) → `vec_intents` KNN + `commands_fts` BM25 → hybrid fusion.
- Catalog generation: cheat sheet + tldr (command universe) + Pro Git (multi-step context); flags validated via git-scm docs + `git help`. Sources stay in gitignored `data/cache/`; commit derived `commands.json` / `intents.jsonl` / DB on `improve/*` after eval.
- Search: sqlite-vec cosine KNN + FTS5 BM25 → weighted fusion + confidence-gated display.
- Web playground: **web-catalog.db** (sql.js) + Transformers.js MiniLM (`@git-grasp/core/browser`) — no `bun:sqlite` in the browser bundle.
- Bun path uses `BunSqliteAdapter`. Release binaries use `bun build --compile` plus adjacent `data/` / `config/`.

### Web playground / e2e

```bash
bun run seed          # if DB missing
bun run web:pack      # regenerate catalog pack + overlay size constant
bun run web:dev

# e2e (a11y + tracking via window.__ghTrackQueue)
bun run web:build
bunx --filter @git-grasp/web playwright install chromium
bun run web:e2e

# optional local Umami for manual script checks
docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
# then set PUBLIC_UMAMI_SCRIPT_URL / PUBLIC_UMAMI_WEBSITE_ID in apps/web/.env
```

Playground query params: `?mock=1` (mock embeddings), `?optin=1` (force download overlay).

Umami events: `web_cli_load`, `web_cli_search` (cookieless); CLI opt-in: `cli_opt_in`, `cli_search`. On `main`, Pages + e2e run from `.github/workflows/release.yml`.

## Git flow

- `main` — release; golden eval gate; Pages deploy
- `develop` — integration
- `feature/*` — **code** (schema, pipeline, CLI/web); fixtures only — no production catalog/DB rebuilds
- `improve/*` — regenerated `data/catalog/*` + `data/git-commands.db` after a successful eval gate
- Tags `v*` on `main` — binaries + npm publish

Do not commit upstream corpora (Pro Git / tldr trees). Sources fetch to gitignored `data/cache/`.
## CI secrets

| Secret | Used for |
|--------|----------|
| `DEEPSEEK_API_KEY` | Golden eval / improve (required on main gate) |
| `NPM_TOKEN` | `bun publish` on `v*` tags |

Pages and GitHub Releases use the built-in `GITHUB_TOKEN` (workflow permissions).

## Security

See `local/spec/SECURITY.md` (private specs). No API key required for end users. DB checksum verified on search. CLI telemetry is opt-in; see **Privacy / telemetry** above.
