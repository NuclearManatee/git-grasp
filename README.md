# git-help

Local-first CLI for **semantic search** of Git commands. Intents are keyed by pasteable **examples**, tagged with skill levels (`non-technical` → `expert`) and matched with on-device embeddings. The CLI never runs Git for you.

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
git-help set-level beginner
git-help set-level 2
git-help set-level clear
git-help doctor
```

`set-level` restricts results to **at most** that skill. Flags: `--verbose` (explanation + optional advanced alternate), `--copy` (copies the pasteable example).

Offline after install. Maintainer features need `DEEPSEEK_API_KEY` in `.env` (DeepSeek V4 Pro). Optional: `GIT_HELP_LLM_PROVIDER=groq` + `GROQ_API_KEY`.

## Maintainer scripts

| Script | Purpose |
|--------|---------|
| `npm run build-catalog` | Full catalog (glossary→docs→examples→families→intents→normalize) |
| `npm run download-docs` | Mirror allowlisted git-scm.com docs locally |
| `npm run build-catalog:glossary` | Concrete token glossary for examples |
| `npm run build-catalog:commands` | Extract command + pasteable examples |
| `npm run build-catalog:families` | Assign intent families + simplicity ranks |
| `npm run build-catalog:intents` | Per-example intents (3–5 × 4 skills) |
| `npm run build-catalog:normalize` | Normalize + golden inject |
| `npm run seed` | Embed intents → `data/git-commands.db` (+ checksum) |
| `npm test` | Unit + integration (Vitest) |
| `npm run eval` | Golden eval + dual command/example judge |
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
