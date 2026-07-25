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

Offline after install. Maintainer features need `GROQ_API_KEY` in `.env`.

## Maintainer scripts

| Script | Purpose |
|--------|---------|
| `npm run build-catalog` | Build `data/catalog/*` (≥200 commands) |
| `npm run seed` | Embed intents → `data/git-commands.db` (+ checksum) |
| `npm test` | Unit + integration (Vitest) |
| `npm run eval` | Golden eval + judge |
| `npm run improve` | Scripted threshold improve loop on `improve/*` |

Use mock embeddings in CI: `GIT_HELP_MOCK_EMBEDDINGS=1`.

## Git flow

- `main` — release; golden eval gate
- `develop` — integration
- `feature/*` — work
- `chore/catalog-*` — seed artifacts
- `improve/*` — improve-loop commits only

## Security

See `local/spec/SECURITY.md` (private specs). No API key required for end users. DB checksum verified on search.
