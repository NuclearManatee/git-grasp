# git-help

Local-first CLI for **semantic search** of Git commands. Multi-level intents (skill 1–5) are matched with on-device embeddings. The CLI never runs Git for you.

## Install

```bash
npm install
# optional: GIT_HELP_SKIP_POSTINSTALL=1
```

Requires Node.js ≥ 22.

## Usage

```bash
git-help "undo last commit but keep my files"
git-help search "create a branch" --verbose
git-help set-level 2
git-help set-level clear
git-help doctor
```

Flags: `--verbose`, `--copy`.

Offline after install. Maintainer features need `DEEPSEEK_API_KEY` in `.env` (DeepSeek V4 Pro). Optional: `GIT_HELP_LLM_PROVIDER=groq` + `GROQ_API_KEY`.

## Maintainer scripts

| Script | Purpose |
|--------|---------|
| `npm run build-catalog` | Full catalog (local docs→Are You Sure?→per-command intents→normalize) |
| `npm run download-docs` | Mirror allowlisted git-scm.com docs locally |
| `npm run build-catalog:commands` | Step 1 only (resume-safe) |
| `npm run build-catalog:intents` | Step 2 only — one command per call, concurrent (no batching) |
| `npm run build-catalog:normalize` | Step 3 only |
| `npm run seed` | Embed intents → `data/git-commands.db` (+ checksum) |
| `npm test` | Unit + integration (Vitest) |
| `npm run eval` | Golden eval + LLM judge |
| `npm run eval:loop` | 5 cycles (golden+≥30 new) then final gate |
| `npm run improve` | Scripted threshold improve loop on `improve/*` |

Default provider: **DeepSeek** `deepseek-v4-pro` with a concurrency rate limiter (official cap 500). Tune with `GIT_HELP_LLM_CONCURRENCY` (default 16). Re-run scripts to resume after pauses (exit 20).

## Git flow

- `main` — release; golden eval gate
- `develop` — integration
- `feature/*` — work
- `chore/catalog-*` — seed artifacts
- `improve/*` — improve-loop commits only

## Binaries

Standalone `pkg` / SEA binaries are planned after the npm path is stable. Use `npm install -g` / `npx git-help` for now.

## Security

See `local/spec/SECURITY.md` (private specs). No API key required for end users. DB checksum verified on search.
