# CLAUDE.md

Project guidance for AI assistants working in this repo.

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
