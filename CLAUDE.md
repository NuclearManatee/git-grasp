# CLAUDE.md

Project guidance for AI assistants working in this repo.

## Catalog philosophy (required)

The shipped Git catalog is **LLM-built from `git help` + a goal taxonomy**, not hand-curated at each pipeline stage.

- **Lifecycle:** PREPARE → GENERATE → EXPAND → SHIP → SEARCH → OBSERVE → EVOLVE.
- **Sources in, intuition through:** scrape → goal taxonomy → per-leaf generate/validate/saturate → held-out → improve triage. Do **not** design steps that require a human to author goldens or per-verb recipe lists as the normal path.
- **Code may constrain; humans must not fill the catalog:** Zod schemas, caps, sandbox rules, and structural validators are fine. Checked-in **content** (canonical recipes, held-out queries) should be **LLM-generated** (and regenerable).
- **Follow-up LLM passes are encouraged** when they replace curation: taxonomy reflection, back-translation, triage, gap-cluster expansion.
- **Exceptions:** scrape-derived `git_commands.json` and LLM-built `goal_taxonomy.json` are infrastructure. Skill/category axes are **parked** (not used for retrieval in v9).

## Stack

- **Runtime:** Bun (`bun:sqlite` + `sqlite-vec`).
- **Monorepo:** `common`, `apps/cli`, `apps/pipeline`, `apps/web`.
- **Pipeline layout:** `apps/pipeline/src/` is the Anvil catalog script (`index.ts`, `commons/`, `steps/`, `tests/bun/`, `README.md`); stage facades `common/src/{prepare,…,evolve}/`.
- **Search:** Hybrid description KNN (`vec_recipes`) + FTS5 (`recipes_fts`) → fixed-blend fusion + confidence-gated display. **No LLM at query time.** Schema **v9**.
- **Catalog:** code on `feature/*`; versioned `recipes.json` / seeded DB on `improve/*` after regression + held-out gates.
- **LLM prompts:** `common/prompts/<area>/<name>.md` via `renderPrompt` / `renderPromptRole`.
- **Docs:** runbooks in app READMEs (`apps/cli/README.md`, `apps/pipeline/src/README.md`, `apps/web/README.md`); philosophy and architectural decisions in `docs/`. Index: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Branch policy: [docs/BRANCHING.md](docs/BRANCHING.md).
- **Layout:** shipped under `common/data` + `common/config`; scratch under `local/`; tests under `test/{unit,integration,performance}`.

## Git flow (required)

Use **git-flow**. Do not commit product/code changes straight to `main` or mix concerns on the wrong branch type.

### Branches

| Branch | Purpose |
|--------|---------|
| `main` | Release line. Merge only after the relevant gate. |
| `develop` | Integration. Keep in sync with `main` after merges. |
| `feature/*` | **Code** changes only. |
| `improve/*` | **Eval / EXPAND** outcomes: catalog rebuild artifacts, seeded DB, reports. |
| `chore/catalog-*` | Catalog/seed maintenance when not part of an improve cycle. |

### What goes where

- **Code** → `feature/*` → `develop` → `main`.
- **Eval/catalog** → `improve/*` after held-out + regression green → `develop` → `main`.
- Never force-push `main`. Only create commits when asked.

### Eval gate reminder

Leaf held-out (≥0.95 ×2) + regression set unlock catalog merges. EXPAND triage buckets 1/2/3 are automated (including taxonomy-gap expansion).
