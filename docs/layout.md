# Layout conventions

| Path | Purpose |
|------|---------|
| `apps/cli` | CLI application |
| `apps/pipeline` | Batch catalog build + eval |
| `apps/web` | Astro site + playground |
| `common/` | Shared library + **shipped** `data/` and `config/` |
| `common/prompts/` | LLM prompt markdown |
| `common/taxonomy/` | Frozen / scraped taxonomy infrastructure |
| `docs/` | Project documentation |
| `test/unit` | Vitest unit tests |
| `test/integration` | Bun integration tests |
| `test/performance` | Bench harness + `queries.json` |
| `local/` | Gitignored scratch: caches, eval reports, bench outputs |
| `common/scripts/` | Hooks (`postinstall`, `ci-audit`, `warm-model`) |
| `.github/` | CI workflows |

Do not put caches under `common/data/`. Do not put application refactors on `improve/*` or catalog rebuilds on `feature/*` without following [CLAUDE.md](../CLAUDE.md) git-flow.
