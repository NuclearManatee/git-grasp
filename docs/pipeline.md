# Pipeline

How git-grasp builds its offline Git catalog: validated **recipes** (what to run) plus **intents** (how people ask for them). Runtime CLI/web never run this path; they only search the shipped database.

Catalog philosophy ([CLAUDE.md](../CLAUDE.md)): models derive catalog **content** from sources. Code may constrain (Zod, caps, sandbox rules). Checked-in encyclopedias of recipes or queries are not the normal path—LLM artifacts should be regenerable.

This document follows four sections:

1. **Resources** — inventory of knowledge inputs (not a pipeline step).
2. **Prerequisites** — frozen language of the system, plus intermediate pipelines that produce inputs for ground.
3. **Ground** — first construction pass and its evaluation gate.
4. **Iterate** — evolve loop construction and its evaluation gate.

Schema for staging and product is **v7** (`commands` + `intents`, with `mutation_kind` on recipes). Caps: ≤ 25 000 commands, ≤ 250 000 intents.

```text
Resources (docs, git -h, taxonomies, …)
        → Prerequisites (scrape → matrix → ingest → prepare)
        → Ground (generate → validate → intents → dedup + eval gate)
        → Iterate (mutate → same pipeline + eval gate)
        → promote / seed product DB
```

Maintainer entrypoints live under `apps/pipeline` (root `bun run …` wrappers):


| Script                                     | Phase                         |
| ------------------------------------------ | ----------------------------- |
| `bun run taxonomy:scrape`                  | Prerequisites                 |
| `bun run taxonomy:matrix`                  | Prerequisites (intent matrix) |
| `bun run ingest-sources` / `download-docs` | Prerequisites                 |
| `bun run build:prepare`                    | Prerequisites (intermediate)  |
| `bun run build:ground`                     | Ground                        |
| `bun run build:loop`                       | Iterate                       |
| `bun run seed` / `eval` / `eval:loop`      | After catalog promote         |


---



## 1. Resources

Not a step. This is the **inventory of knowledge** the pipeline may read. Everything below is input material or frozen vocabulary; none of it is a shipped recipe by itself.

### 1.1 Frozen taxonomies (system language)

These define *how* the catalog talks about users and commands. They are infrastructure, not catalog content. **How they are created** is documented in §2.0.


| Resource               | Path                                 | What it is                                                 | Source                                |
| ---------------------- | ------------------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| Intent matrix          | `common/taxonomy/intent_matrix.json` | 4×4 skill × category cells (description + dos/donts)       | LLM builder (`taxonomy:matrix`)       |
| Skill / category enums | `common/src/lib/skills.ts` + Zod     | Closed label ids for intent rows                           | Architectural Decision (Human Driven) |
| Command list           | `common/taxonomy/git_commands.json`  | Which Git verbs exist (first three `git help -a` sections) | Scrape                                |




### 1.2 External documentation

Authoritative prose the prepare step chunks and routes onto commands.


| Kind                   | Typical origin                      | Cache / ship location                                                    |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Pro Git (AsciiDoc)     | Upstream book                       | Maintainer cache under `local/cache/sources/` (or legacy `data/cache/…`) |
| tldr pages             | Upstream tldr                       | Same sources cache                                                       |
| Cheat sheets / mirrors | Fetched HTML or mirrors             | Sources cache + optional `common/data/catalog/docs`                      |
| Man / help text        | Live `git <cmd> -h` at prepare time | Embedded as default blocks per verb (not a separate file tree)           |


Upstream fetches are **gitignored** scratch. Shipped doc mirrors under `common/data/catalog/docs` are improve-gate artifacts when promoted.

### 1.3 What resources are *not*

- Not hand-written goldens for every goal.
- Not a curated per-verb recipe encyclopedia maintained by humans.
- Not role/pin encyclopedias (`GOAL_ROLES`, canonical pins)—removed; coverage comes from scrape + ground/iterate.
- Not runtime search indexes (`vec_intents`, FTS)—those are **outputs** after ground/iterate/promote/seed.

---



## 2. Prerequisites

Everything that must exist **before** ground can generate vanilla recipes. Split into: how the system language is created, one-shot taxonomy jobs, source ingest, and **prepare** (the main intermediate pipeline).

**Order:**

```text
create / freeze skill×category enums   (code)
    → taxonomy:scrape                  (git_commands.json)
    → taxonomy:matrix                  (intent_matrix.json; Flash draft, Pro judge)
    → ingest / download-docs
    → build:prepare                    → semantic_blocks.json (+ unrouted report)
    → ready for ground
```

Prepare does **not** re-scrape or rebuild the matrix. It only reads checked-in taxonomy files and cached sources.

---



### 2.0 How the language of the system is created


| Artifact             | Path / symbol                                      | How it is created                                                                              | Regenerable?                                    |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Intent matrix        | `common/taxonomy/intent_matrix.json`               | **LLM builder**: Flash drafts/rewrites cells; Pro blind-judges samples; all 16 cells must pass | Yes — `bun run taxonomy:matrix`                 |
| Skill / category ids | `SKILL_LEVELS` / `INTENT_CATEGORIES` in code + Zod | Frozen closed vocabularies (matrix axes)                                                       | Only when the product’s label space must change |
| Command list         | `common/taxonomy/git_commands.json`                | **Programmatic scrape** (`git help -a`)                                                        | Yes — when the Git CLI verb list changes        |


**Do not** hand-curate matrix cells as a living encyclopedia. Prefer the machine-checkable builder (draft → sample via real expand path → blind judge → rewrite). Code may constrain (Zod, exactly 16 cells); humans approve freezes, they do not invent ad-hoc labels per recipe.

```text
Product goals + Git UX context
        → freeze skill × category enums in code
        → taxonomy:matrix (Flash + Pro judge) → intent_matrix.json

Installed `git` binary
        → taxonomy:scrape → git_commands.json
```



#### Intent matrix (LLM builder)

**Output:** `common/taxonomy/intent_matrix.json` — 16 cells, each `{ skill_level, intent_category, description, dos[], donts[] }`.

**Creation process (**`bun run taxonomy:matrix`**):**

1. **Draft** (DeepSeek Flash): one focused call per cell using frozen axis context.
2. **Sample**: generate intents via `taxonomy/sample-cell-intents` + shared `filterIntentsForRecipe` on a minimal recipe fixture (not the ground `build/expand-intents` prompt).
3. **Judge** (DeepSeek **Pro only**): blind eval — judge sees guidance + sample texts, **never** skill/category labels. Rubrics from dos/donts + usefulness (diversity, jargon leaks). Success = **all 16 cells pass**.
4. **Rewrite** (Flash): failing cells only; do not mirror judge wording (anti-overfit).
5. Stop after **10 consecutive failed rounds**, or write the matrix on first all-pass.

Reports land under `local/eval/intent-matrix/` (gitignored). Ground and build/eval loops stay on **Flash** (default model); only the matrix judge uses Pro.


| Skill          | Plain meaning                                               |
| -------------- | ----------------------------------------------------------- |
| `nontechnical` | Little Git vocabulary; symptoms and panic in plain language |
| `beginner`     | Knows basic nouns; asks how-to; may misuse commands         |
| `intermediate` | Daily porcelain; remotes and conflicts in practice          |
| `expert`       | Mechanics, flags, shorthand; high-signal phrasing           |



| Category         | Plain meaning                             |
| ---------------- | ----------------------------------------- |
| `goal`           | Desired outcome (“create a new branch”)   |
| `error_message`  | Echo or paraphrase of a Git error/warning |
| `symptom`        | Broken state without naming the fix       |
| `conversational` | Chatty / incomplete phrasing              |


Together these labels are the **label space** for `intents` rows. Expand-intents injects the full matrix (description + dos/donts per cell).

#### Command taxonomy (scrape — not LLM)

See §2.3. This is the only prerequisite whose **source of truth is the installed Git binary**, not an LLM.

---



### 2.1 Intent matrix (checked-in output)

See §2.0. Checked-in file: `common/taxonomy/intent_matrix.json`. Rebuild with `bun run taxonomy:matrix`.

---



### 2.3 Command taxonomy (`taxonomy:scrape`)

```bash
bun run taxonomy:scrape
```

**Creation process (programmatic):**

1. Spawn `git help -a` on the maintainer machine (`apps/pipeline` → `taxonomyScrape` / `gitExec`).
2. Parse sections; keep the **first three**: Main Porcelain Commands, Ancillary Commands / Manipulators, Ancillary Commands / Interrogators.
3. Probe each help name for local availability:
   - `git <name> -h` usable → `command: "git <name>"`, `runner: "git"`, `available: true`
   - else standalone on PATH under a trusted Git prefix (`gitk`, `scalar`) → `runner: "standalone"` (rejects Windows `System32\CiTool.exe` false positives)
   - else → `available: false` (kept for reporting; prepare/ground skip these)
4. Build a versioned JSON document (`version: 2`, name, section, summary, `command`, `available`, `runner`, `scraped_at`, `availability` stats).
5. Write `common/taxonomy/git_commands.json`. Fail closed if section count ≠ 3 or the command count looks suspiciously low. Scrape CLI prints available / unavailable / standalone counts.

**Why it exists:** every later stage needs a closed list of “what is a real Git verb here,” plus whether it is runnable on the maintainer machine. Prepare anchors use the normalized `command` (may be standalone) plus the help summary. Ground skips `available: false` and unsigned `verify-*` (no GPG fixture in v1) with structured reasons (`unavailable`, `verify_unsigned`)—not `regen_exhausted`.

**When to re-run:** only when the Git CLI command list or install capabilities meaningfully change. Not part of every prepare. Never hand-edit the JSON as a catalog of recipes—re-scrape instead.

---



### 2.5 Doc sources (ingest)

```bash
bun run ingest-sources
bun run download-docs
```

**What they do:** fetch or refresh Pro Git, tldr, cheat-sheet, and related mirrors into the maintainer sources cache; optionally refresh the catalog docs mirror.

**Why before prepare:** prepare only chunks and routes what is already on disk. No network inventiveness inside the chunker.

Scratch lives under `local/cache/sources/` (gitignored). Promoted mirrors, when checked in, follow improve-branch discipline.

---



### 2.6 Prepare — intermediate pipeline (`build:prepare`)

```bash
bun run build:prepare
```

**Role:** turn resources + taxonomy into **one documentation bundle per Git command**, ready for ground. Outputs are cached under the prepare cache and are **not** wiped by ground/loop cache clears.


| Output                  | Meaning                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `semantic_blocks.json`  | For every **groundable** taxonomy command: `-h` + goal-stub + routed doc chunks             |
| `unrouted_chunks.jsonl` | Chunks that never cleared the similarity floor (logged; not fed to ground)                  |
| `goal_gaps.json`        | Groundable verbs whose blocks are help/stub only (no routed prose) — maintainer report      |


**Steps inside prepare:**

1. **Taxonomy load** — Read checked-in `git_commands.json`. Anchors = groundable verbs only (`available !== false`, skip unsigned `verify-*`) using normalized `command` + summary. No re-scrape.
2. **Hierarchical chunking** — Parse AsciiDoc/Markdown; paragraph-level chunks; keep code fences / tldr backtick examples bound to nearby prose; prepend path prefixes (e.g. `[Pro Git > Chapter 3 > Basic Branching]`).
3. **Embed & multi-anchor route** — Embed chunks and taxonomy nodes with build-time `text-embedding-3-small`. Assign each chunk to up to **N ≤ 3** anchors by cosine similarity: absolute floor **0.75**, keep scores within **Δ = 0.05** of the chunk’s best score, then hard-cap N. A matched chunk is **duplicated** into each assigned command’s block list. Literal `git <name>` mentions are lifted to at least the floor. Below-floor for all anchors → `unrouted_chunks.jsonl`.
4. **Default blocks** — For **every groundable** verb: (a) taxonomy summary + `git <cmd> -h` (`metadata_source` = `git/-h/<name>`; exit 129 is normal — do **not** call plain `git help <cmd>`); (b) a short **goal-stub** block (`goal-stub/<name>`).
5. **Compile** — Deterministic `semantic_blocks[]` with **one entry per groundable command**: `command` + `blocks[]` (`-h` first, then goal-stub, then routed children). Also write `goal_gaps.json` for help/stub-only verbs.

Clustering, functional category, and synthesized snippet fields are **not** produced here.

**Data model preview (filled later by ground/iterate):**


| Table      | Role                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| `commands` | Recipe rows: `initial_state`, `command_recipe`, physical hashes, `risk`, optional `parent_row_id` / `mutation_kind` |
| `intents`  | NL variants linked to a `command_id`, with `skill_level` + `intent_category`                                        |


Build-only `vec_commands` may exist for the evolve neighbor search; it is dropped on promote. Product ships `vec_intents` (384-d MiniLM), `commands_fts`, and `meta`.

---



## 3. Ground

First catalog construction: **vanilla** recipes—one primary command, minimum args/flags—plus intents. Runs over `semantic_blocks` into a **staging** DB (`bun run build:ground`).

---



### 3.1 Construction

Four steps per semantic block:


| Step                   | Input                            | Action                                                                                                                         | Output                                      |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **1 Generation**       | one `semantic_block`             | LLM → vanilla recipe JSON                                                                                                      | candidate                                   |
| **2 Validation**       | state + recipe                   | Fail-closed flag allowlist (`git -h` + tiny denylist), then sandbox run; reflective regen on failure; hash physical Git state on success | `*_physical_hash`                           |
| **3 Intent expansion** | validated recipe + intent matrix | Iterative Flash expand (cell coverage + MiniLM dedup); see below                                                               | `intents[]` (≤ 32)                          |
| **4 Deduplication**    | hash pair + recipe fingerprint   | Collision against global DB (physical hashes, then secondary fingerprint); keep the simpler recipe (fewer commands/flags); merge intents with authoritative cosine prune | unique row or keep-existing                 |


**Intent expansion (iterative)**

Per accepted recipe, grow intents until every matrix cell is **filled** or honestly **skipped** (not a forced 16-intent fill):

1. Flash batch (≤ **8**) biased toward **empty** cells; may return `skips[]` with reasons for cells that do not fit. Primary remains the topic; about **1–2** intents per batch may lightly mention a recipe delta (extra step / flag / situation) when present in the full listing or `initial_state`.
2. Fidelity filter (command-like / cross-verb traps).
3. Embed with local MiniLM; drop **within-recipe** near-dups (cosine ≥ **0.90**).
4. Best-effort **foreign** check vs staging `vec_intents` (cosine ≥ **0.94**, other `command_id`): one contrastive Flash rewrite, else drop. Lag under concurrency is OK.
5. Persist-time (writer queue): authoritative within + foreign cosine drop (no rewrite) before insert.
6. Exit when all cells decided, **zero-growth** streak of **3**, per-recipe cap **32**, or global `MAX_INTENTS`.

Same path for ground and evolve children. Flash only (no Pro). The expand prompt receives the **full** recipe step listing (primary marked).

**Sandbox headlessness:** each job gets PATH stubs under `sandbox/shims/` (`gitk`, `git-gui`, diff/merge tools, no-op `grasp-editor`). GUI verbs invoke stubs (log argv, exit 0) instead of opening windows. `GIT_EDITOR` / `EDITOR` / `VISUAL` / `GIT_SEQUENCE_EDITOR` always point at the editor shim. Opt-in `blockGui: true` restores fail-closed `sandbox_gui_blocked` for regression tests. `$GIT_GRASP_REMOTES` is set to a per-job remotes directory for push/pull fixtures.

**Generation contract**

- **In:** one `semantic_block` (`command` + all `blocks[].content` as context).
- **Out:** `{ "initial_state": string, "command_recipe": { "commands": [{ "command", "comment" }] }, "risk": number }`
- **Vanilla rules:**
  - Primary recipe step must be the block’s `command` with the **minimum** args/flags to be valid in the sandbox.
  - Prefer a **single** step; allow 1–2 only when the command cannot demonstrate alone.
  - `initial_state`: minimal setup after harness `git init` + identity (empty commit / one file only when required). Push/pull may create a bare remote under `$GIT_GRASP_REMOTES`. Describe/restore/history follow the vanilla prompt constraints.
  - Each step is a single invocation (`git …` or standalone like `gitk`/`scalar`)—**no** shell metacharacters (`&&`, `|`, `;`, backticks) in the command line.
  - Flags must appear in that verb’s `git -h` allowlist (**fail closed** if help/allowlist empty and flags are present). Denylist includes known junk (e.g. `--i-still-use-this`) even if Git accepts it.
  - `risk` ∈ `[0, 1]` (destructive risk).

Accepted rows also feed eval banks (`golden` / `extended` / `scrambled`). Ground DB rows keep `mutation_kind = NULL`; eval bank rows are tagged `mutation_kind: "ground"`.

---



### 3.2 Evaluation

In-build retrieval gate scores what the **CLI would show**: hybrid `displayResults` (confidence-gated, 0–3 slots), not the fuller internal fused `results` list. When the query names a Git verb, hybrid ranking applies a soft **+0.25** boost to hits whose primary step matches that verb (then re-sorts).

**Bank generation** (on each dedup-accepted unique insert, unless `skipEvalBanks`):

1. **Golden** — LLM (`build/golden-query`) writes one NL query for the recipe (primary-verb focused; may include one distinguishing cue when the recipe is richer). Fidelity checks require the primary verb token and reject near-dups / banned templates. Failures fall back to `how do I use git <verb>` and are routed to `golden-report.jsonl` (excluded from the hard gate). Tagged `mutation_kind: "ground"` + `primary_verb`.
2. **Extended** — LLM (`build/expand-queries`) emits **3** paraphrases of the golden → `extended.jsonl` (same tags).
3. **Scrambled** — light adversarial noise (`scrambleQuery`) over each extended variant → `scrambled.jsonl` (same tags).

Banks live under `common/data/eval/` (`golden.jsonl`, `extended.jsonl`, `scrambled.jsonl`). The hard gate runs on **golden only** (fallbacks excluded).

**Pass / miss (per query):**

1. Search the staging DB; take `displayResults` (**Hit@display** = exact expected `command_id` among shown hits).
2. On miss only: LLM utility judge (`build/judge`) scores honest usefulness 0–1 (no pass cliff in the prompt); Pass A if `utility >= 0.9`.
3. Dual hard gate (both required): Hit@display-only rate ≥ **0.7**, then Pass A (hit OR judge) ≥ **0.9**. If Hit@display already cannot clear 0.7, Phase-2 judge is skipped.


| Check             | Rule                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------- |
| **Hard gate**     | Golden **Hit@display** ≥ **0.7** **and** **Pass A** ≥ **0.9** (exact `command_id` in `displayResults`, or judge) |
| **Report only**   | Pass B (expected primary verb among displayed hit verbs); rates by `mutation_kind`            |


Ground fails if the dual gate fails. Product-facing `bun run eval` / `eval:loop` after promote is a separate improve-branch workflow; this section is the **in-build** gate while staging grows.

---



## 4. Iterate

Interactive evolve loop (`bun run build:loop`): grow diversity from accepted **leaves** (recipes with no children) until coverage saturates or caps hit.

---



### 4.1 Construction

**Stop when any of:**

- Dedup inserts **no new unique rows** for **N** consecutive cycles (default **N = 3**), or
- **Every** taxonomy verb is saturated (below), or
- Global hard caps (`MAX_COMMANDS` / `MAX_INTENTS`) or max iterations hit.

**Saturation (per verb, multi-bucket).** Each accepted recipe increments coverage for its **primary** verb only (first recipe step). A verb is saturated when it has **K ≥ 24** unique recipes **and**:


| Axis            | Floor                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **State**       | ≥ 3 of `{minimal, dirty_worktree, with_remote, detached_or_diverged}` among recipes whose primary verb is that verb              |
| **Flags**       | ≥ **3** distinct flag-fingerprints (normalized flags on steps for that verb)                                                    |
| **Composition** | ≥ 1 length-1 recipe, ≥ 3 with length ∈ [2, 3], ≥ 2 with length ∈ [4, 7] (or axis exhausted, e.g. all leaves already at 7 steps) |


**Batch each cycle:** size = `min(|leaves|, 256)`. Prefer **undersampled** verbs first; within the pool, stratify by risk. First fan-out mutates ground bases; later cycles compound via unsaturated leaves.

**Multi-axis mutation** — For each selected leaf, pick the **weakest coverage axis** across its verbs (tie-break: **State → Flag → Composition**). Retrieve ~10 neighbors (similar/distant intents and recipes + random), biased toward the mutation kind. Then:


| Kind            | Action                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **State**       | Harden `initial_state` (remotes, dirty tree, detached HEAD, divergence). Recipe **verbs** unchanged.                                                                                                |
| **Flag**        | Change flags/args on existing steps using that step’s `git <cmd> -h` allowlist; ≤ **3** flags per step. **Never** change git verbs.                                                                |
| **Composition** | Insert a command line before / middle / after (`insert_index`); hard cap **≤ 7** steps; any `git` subcommand whose `-h` returns usage; flags fail-closed allowlisted like ground; no shell metacharacters. Skip if parent already has 7 steps. |


Persist `mutation_kind` ∈ `{state, flag, composition}` on the child; set `parent_row_id`.

**Then re-run** validation → intent expansion → dedup on the child (same construction pipeline as ground).

---



### 4.2 Evaluation

On each **dedup-accepted** evolve insert: append **golden + extended + scrambled** (same shape as ground), tagged with the child’s `mutation_kind` + `primary_verb`. Golden / extended prompts are **situation-aware** (prompt-only): still primary-verb focused, but nudged to include one distinguishing cue from extra steps, distinctive flags, or non-minimal `initial_state` when present. Intent expansion stays primary-focused with a soft optional delta (about **1–2 intents per Flash batch** may mention that cue).

Hard gate still runs on **golden only** (fallbacks excluded). Extended/scrambled are report banks.

After **each** cycle (same dual gate as §3.2):


| Check           | Rule                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| **Hard gate**   | Full golden bank **Hit@display** ≥ **0.7** **and** **Pass A** ≥ **0.9** (same definition as ground) |
| **Report only** | Stratified rates by `mutation_kind`; Pass B; per-verb rates (do not hard-fail on bucket/verb alone) |


Example log shape:

```text
eval hit@display=0.80 (40/50) okHit=true minHitAtDisplay=0.7
eval passA=0.92 (46/50) okPass=true minPassRate=0.9 (hit=40 judge=6)
eval overall ok=true (requires hit@display>=min AND passA>=min)
eval byKind ground=0.95 state=0.90 flag=0.88 composition=0.85
eval verbPassB=0.84 (42/50)
```

**Promote handoff** (after ground/iterate succeed):

- Write coverage report (`common/data/eval/coverage-report.json`) from per-verb coverage.
- **Warn** (do not block) if fewer than **80%** of taxonomy verbs have ≥ **3** recipes.
- Finalize FTS + `git_verbs` meta, drop build-only `vec_commands`, promote staging → shipped catalog / DB. Checksum is produced by `bun run seed`, not by promote itself.
- Catalog quality merges follow git-flow `improve/*` after the product eval gate (`bun run eval` / `eval:loop`).

Changing prepare / generation / evolve contracts requires a **full rebuild** (prepare → ground → iterate → promote). There is no migrate path from prior prepare artifacts or schema v6 staging DBs.

---



## Related docs

- [Architecture](architecture.md) — packages and data layout
- [Layout](layout.md) — where caches vs shipped artifacts live
- [Goals](goals.md) — product goals
- Spec scratch: `local/spec/FULL_STEP_PROCESS.md` (authoring notes; this file is the explained maintainer doc)

