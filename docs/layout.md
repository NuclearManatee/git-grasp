# Layout conventions

| Path | Purpose |
|------|---------|
| `apps/cli` | CLI — **SEARCH** + **OBSERVE** |
| `apps/pipeline` | Catalog Anvil script — `src/{index.ts,commons,steps,tests,README.md}` plus eval/evolve one-offs |
| `apps/web` | Astro site + playground — **SEARCH** + **OBSERVE** |
| `common/` | Shared library + **shipped** `data/` and `config/` |
| `common/src/{prepare,generate,expand,ship,observe,evolve}/` | Stage facades / stage impl |
| `common/src/build/` | Implementation: scrape, taxonomy, leaf pipeline, triage, corpus |
| `common/src/search/` | Hybrid retrieval (**SEARCH**) |
| `common/prompts/` | LLM prompts: `taxonomy/`, `build/`, `improve/`, `evolve/` |
| `common/taxonomy/` | `git_commands.json`, `goal_taxonomy.json`, `flag_denylist.json` |
| `docs/` | One MD per lifecycle stage + indexes (`docs/evolve/latest.md` stats) |
| `test/{unit,integration,performance}` | Tests |
| `local/` | Gitignored scratch |
| `common/scripts/` | Hooks (`postinstall`, `ci-audit`, `warm-model`) |
| `.github/` | CI workflows |

Do not put caches under `common/data/`. Follow [git-flow.md](git-flow.md) / [CLAUDE.md](../CLAUDE.md). Stage details: [pipeline.md](pipeline.md). Maintainer scripts: [maintainer.md](maintainer.md).
