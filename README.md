# git-help

Local-first CLI for **semantic search** of Git commands. Intents are keyed by pasteable **examples**, tagged with skill levels (`non-technical` → `expert`) and matched with on-device embeddings + **sqlite-vec** KNN recall. Answers show a short doc-style **usage** frame. The CLI never runs Git for you.

## Monorepo

Bun workspaces:

| Package | Role |
|---------|------|
| `@git-help/core` | Schema v4, `bun:sqlite` + `sqlite-vec`, MiniLM embeddings, JS re-rank, seed/search facades |
| `@git-help/cli` | CLI UX |
| `@git-help/seeding` | Catalog → DB |
| `@git-help/eval` | Golden / loop eval |
| `@git-help/web` | Astro stub (browser search adapter later) |

Shared seeds and search live in `packages/core`. CLI and web are views only.

## Install

Requires **Bun ≥ 1.1**.

```bash
bun install   # uses bun.lock
# optional: GIT_HELP_SKIP_POSTINSTALL=1
bun run seed
```

Postinstall smoke-loads the platform `sqlite-vec` native. Embedding model downloads on first non-mock embed.

## Usage

```bash
export PATH="$HOME/.bun/bin:$PATH"   # Git Bash / shells without bun on PATH
cd /path/to/git-help
bun install && bun run seed
bun link                             # once → `git-help` on PATH

git-help "undo last commit but keep my files"
git-help search "create a branch" --verbose
git-help set-level beginner
git-help doctor
```

`set-level` restricts results to **at most** that skill. Flags: `--verbose`, `--copy`.

Offline after install + seed. Maintainer features need `DEEPSEEK_API_KEY` in `.env` (or Groq).

## Maintainer scripts

| Script | Purpose |
|--------|---------|
| `bun run rebuild` | Full catalog build + seed DB |
| `bun run build-catalog` | glossary→docs→examples→families→intents→normalize |
| `bun run seed` | Embed intents → `data/git-commands.db` (schema v4 + vec0) |
| `bun test` | Unit (Vitest) + integration (Bun) |
| `bun run eval` | Golden eval |
| `bun run eval:loop` | 5 cycles then final gate |
| `bun run web:dev` | Astro stub |
| `bun run bench` | Search latency harness (see [docs/perf.md](docs/perf.md)) |
| `bun run bench:install` | Slow-network install timing |
| `bun run build:cli` | `bun build --compile` → `bench/git-help` |

Perf budget / Docker profiles: **[docs/perf.md](docs/perf.md)**.
## Architecture notes

- Search: sqlite-vec cosine KNN recall → existing JS rank (family / simplicity / specificity).
- Web uses `BrowserStubAdapter` for now; Bun path uses `BunSqliteAdapter`.
- Standalone `bun build --compile` shipping is a follow-up (load vec beside the binary).

## Git flow

- `main` — release; golden eval gate
- `develop` — integration
- `feature/*` — code (this stack)
- `improve/*` — eval/threshold/catalog outcomes only

## Security

See `local/spec/SECURITY.md` (private specs). No API key required for end users. DB checksum verified on search.
