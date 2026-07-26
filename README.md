# git-help

Local-first CLI for **semantic search** of Git commands. Intents are keyed by pasteable **examples**, tagged with skill levels (`non-technical` → `expert`) and matched with on-device embeddings + **sqlite-vec** KNN recall. Answers show a short doc-style **usage** frame. The CLI never runs Git for you.

Site: [git-help.cremaschi.dev](https://git-help.cremaschi.dev)

## Monorepo

Bun workspaces:

| Package | Role |
|---------|------|
| `@git-help/core` | Schema v4, `bun:sqlite` + `sqlite-vec`, MiniLM embeddings, JS re-rank, seed/search facades |
| `@git-help/cli` | CLI UX |
| `@git-help/seeding` | Catalog → DB |
| `@git-help/eval` | Golden / loop eval |
| `@git-help/web` | Astro marketing site + in-browser Xterm playground |

Shared seeds and search live in `packages/core`. CLI and web are views only.

## Install

Requires **Bun ≥ 1.1** for the package install path. Runtime is Bun (`bun:sqlite`); this is not a Node-native CLI.

### Bun (npm registry)

```bash
bun add -g git-help
git-help "undo last commit but keep my files"
```

From a clone (dev):

```bash
bun install   # uses bun.lock
# optional: GIT_HELP_SKIP_POSTINSTALL=1
bun run seed
bun link      # once → `git-help` on PATH
```

Postinstall smoke-loads the platform `sqlite-vec` native. Embedding model downloads on first non-mock embed.

### Binaries (latest GitHub Release)

Unzip and run from the extracted folder (ships `data/` + `config/` beside the binary):

| Platform | Download |
|----------|----------|
| Linux x64 | https://github.com/cremaschi/git-help/releases/latest/download/git-help-linux-x64.zip |
| macOS Apple Silicon | https://github.com/cremaschi/git-help/releases/latest/download/git-help-darwin-arm64.zip |
| macOS Intel | https://github.com/cremaschi/git-help/releases/latest/download/git-help-darwin-x64.zip |
| Windows x64 | https://github.com/cremaschi/git-help/releases/latest/download/git-help-windows-x64.zip |

Building from `feature/*` / `develop`: **[docs/building-binaries.md](docs/building-binaries.md)**.

## Usage

```bash
git-help "undo last commit but keep my files"
git-help search "create a branch" --verbose
git-help set-level beginner
git-help doctor
```

`set-level` restricts results to **at most** that skill. Flags: `--verbose`, `--copy`.

Offline after install + seed (and model warm). Maintainer / CI features need `DEEPSEEK_API_KEY` in `.env` or GitHub Actions secrets.

## Maintainer scripts

| Script | Purpose |
|--------|---------|
| `bun run rebuild` | Full catalog build + seed DB |
| `bun run build-catalog` | glossary→docs→examples→families→intents→normalize |
| `bun run seed` | Embed intents → `data/git-commands.db` (schema v4 + vec0) |
| `bun test` | Unit (Vitest) + integration (Bun) |
| `bun run eval` | Golden eval |
| `bun run eval:loop` | 5 cycles then final gate |
| `bun run web:dev` | Astro site (landing + playground) |
| `bun run web:build` | Static build → `apps/web/dist` |
| `bun run web:pack` | Export `apps/web/public/catalog/web-pack.bin` from seeded DB |
| `bun run web:e2e` | Playwright a11y + tracking (preview server) |
| `bun run bench` | Search latency harness (see [docs/perf.md](docs/perf.md)) |
| `bun run bench:install` | Slow-network install timing |
| `bun run build:cli` | `bun build --compile` → `bench/git-help` |
| `bun run build:release` | Compile + zip release layout → `dist-release/` |

Perf budget / Docker profiles: **[docs/perf.md](docs/perf.md)**.

## Architecture notes

- Search: sqlite-vec cosine KNN recall → existing JS rank (family / simplicity / specificity).
- Web playground: static **web vector pack** + Transformers.js MiniLM (`@git-help/core/browser`) — no `bun:sqlite` in the browser bundle.
- Bun path uses `BunSqliteAdapter`. Release binaries use `bun build --compile` plus adjacent `data/` / `config/`.

### Web playground / e2e

```bash
bun run seed          # if DB missing
bun run web:pack      # regenerate catalog pack + overlay size constant
bun run web:dev

# e2e (a11y + tracking via window.__ghTrackQueue)
bun run web:build
bunx --filter @git-help/web playwright install chromium
bun run web:e2e

# optional local Umami for manual script checks
docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
# then set PUBLIC_UMAMI_SCRIPT_URL / PUBLIC_UMAMI_WEBSITE_ID in apps/web/.env
```

Playground query params: `?mock=1` (mock embeddings), `?optin=1` (force download overlay).

Umami events: `web_cli_load`, `web_cli_search` (cookieless). On `main`, Pages + e2e run from `.github/workflows/release.yml`.

## Git flow

- `main` — release; golden eval gate; Pages deploy
- `develop` — integration
- `feature/*` — code (this stack)
- `improve/*` — eval/threshold/catalog outcomes only
- Tags `v*` on `main` — binaries + npm publish

## CI secrets

| Secret | Used for |
|--------|----------|
| `DEEPSEEK_API_KEY` | Golden eval / improve (required on main gate) |
| `NPM_TOKEN` | `bun publish` on `v*` tags |

Pages and GitHub Releases use the built-in `GITHUB_TOKEN` (workflow permissions).

## Security

See `local/spec/SECURITY.md` (private specs). No API key required for end users. DB checksum verified on search.
