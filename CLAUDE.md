# CLAUDE.md

Project guidance for AI assistants working in this repo.

## Catalog philosophy (required)

The shipped Git catalog is **LLM-built from authoritative sources**, not hand-curated at each pipeline stage.

- **Sources in, intuition through:** prepare → ground → evolve → intents → eval artifacts must be produced by models operating on scraped/docs/`git -h`/taxonomy inputs. Do **not** design steps that require a human to author pins, goldens, allowlists-of-goals, or per-verb recipe lists as the normal path.
- **Code may constrain; humans must not fill the catalog:** Zod schemas, caps, sandbox rules, and structural validators are fine. Checked-in **content** that is the catalog itself (canonical recipes, seed intents, adversarial queries) should be **LLM-generated** from sources (and regenerable), not maintained as a curated encyclopedia.
- **Follow-up LLM passes are encouraged** when they replace curation: completeness (“what goals are still missing given the taxonomy/sources?”), prune/repair against validators, or self-critique. Prefer machine-checkable prompts over open-ended chat.
- **Exceptions:** small frozen taxonomies that define the *language* of the system (`skill_level.md`, `intent_category.md`, role enums, scrape-derived `git_commands.json` command list) are infrastructure, not catalog content. Prefer regenerating scrape/LLM artifacts over growing hand-written JSON.

## Stack

- **Runtime:** Bun (`bun:sqlite` + `sqlite-vec`).
- **Monorepo:** `packages/core` (DB, embeddings, search), `apps/cli`, `apps/seeding`, `apps/eval`, `apps/web` (Astro site + playground).
- **Search:** Hybrid `sqlite-vec` intent KNN + FTS5 command BM25 → weighted fusion + confidence-gated display in `@git-grasp/core`. Schema v6 (`commands` + `intents` + `vec_intents` + `commands_fts`).
- **Catalog:** generation code on `feature/*`; production `data/catalog/commands.json`, `intents.jsonl`, and seeded DB land on `improve/*` after the eval gate. Upstream source fetches go to gitignored `data/cache/sources/`.
- **LLM prompts:** Do not embed multi-line system/user prompts as TS template literals. Put each LLM call in `packages/core/prompts/<area>/<name>.md` (frontmatter + `## system` / `## user`, Mustache `{{var}}` / `{{{raw}}}`, partials under `prompts/partials/`). Load at runtime with `renderPrompt` / `renderPromptRole` from `packages/core/src/lib/prompts.ts`. Zod schemas stay in TS; taxonomy docs stay in `packages/core/taxonomy/` and are injected as vars.

## Git flow (required)

Use **git-flow**. Do not commit product/code changes straight to `main` or mix concerns on the wrong branch type.

### Branches

| Branch | Purpose |
|--------|---------|
| `main` | Release line. Merge only after the relevant gate. Golden / eval gate applies for catalog quality merges. |
| `develop` | Integration. Keep in sync with `main` after merges. |
| `feature/*` | **Code** changes only: CLI, search, providers, rate limiters, pipeline scripts, tests, docs that describe code. |
| `improve/*` | **Eval / improve-loop** outcomes only: thresholds, catalog rebuild artifacts, seeded DB, eval reports driven by the improve/eval cycle. |
| `chore/catalog-*` | Catalog/seed maintenance when not part of an improve cycle (optional; prefer `improve/*` when eval-driven). |

### What goes where

- **Code adjustments** → always a `feature/*` branch, then merge into `develop` and `main`.
- **Eval adjustments** (generated cases impact, threshold tweaks from the loop, rebuilt `data/catalog/*` + `data/git-commands.db` after a successful eval gate) → always an `improve/*` branch, then consolidate onto `main`.
- Do **not** put large catalog/DB rebuilds on a feature branch unless the change is purely scaffolding with no eval-driven data.
- Do **not** put application refactors on an `improve/*` branch.

### Merge discipline

1. Finish work on the correct branch type.
2. Merge `feature/*` → `develop` → `main` (or fast-forward equivalent).
3. Merge `improve/*` → `develop` → `main` after the eval gate passes.
4. Never force-push `main`.
5. Only create commits when asked (or when the user explicitly requested the full git-flow consolidate step).

### Eval gate reminder

Improve-loop / `eval:loop` success (including the 5 cycles + final gate when that workflow is used) is what unlocks merging eval/catalog outcomes to `main`. Code features still use normal feature merge; they should not bypass the eval gate when they change retrieval/catalog quality that `main` ships.
