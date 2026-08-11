# GENERATE

**Summary:** For each taxonomy leaf, LLM-draft recipes, validate them (flags + sandbox fixtures + judges), and saturate until the discovery curve flattens. Fills the catalog **before** EXPAND.

```mermaid
flowchart TB
  L[Taxonomy leaf] --> G[LLM generate batch]
  G --> V[Validate]
  V --> S{Sandbox + judges OK?}
  S -->|yes| A[Accept + embed description]
  S -->|no| X[Reject]
  A --> D{Discovery flat N batches?}
  D -->|no| G
  D -->|yes| C[Leaf checkpoint]
  X --> D2{More batches?}
  D2 -->|yes| G
  D2 -->|no| F[Leaf fail / zero_accepts]
```

## What it does

1. **Generate** — templated commands, title, description, fixture enum, paraphrases.
2. **Validate** — cheap structure → LLM plausibility → `git -h` flag allowlist → sandbox on structured fixtures → meaningfulness + back-translation. Failed candidates are rejected; the next discovery batch tries again (no in-place regen on the product leaf path).
3. **Saturate** — batches until distinct-new rate is flat for N consecutive batches **after** at least one accept. All-reject batches do not count as flat checkpoints.
4. **Identity** — structural argv fingerprint (literals and `<placeholders>` collapse); near-dup descriptions dropped.
5. **Ground success** — requires checkpoint coverage across leaves (default ≥90%) and a bounded error rate (default ≤10%), not merely “any leaf has recipes.”

## Code

| Path | Role |
|------|------|
| `apps/pipeline/src/generate/ground.ts` | Parallel leaf ground |
| `common/src/generate/` | Stage facade |
| `common/src/build/leafGenerate.ts` | Batch generate |
| `common/src/build/recipeValidate.ts` | Validation chain |
| `common/src/build/leafSaturate.ts` | Discovery curve |
| `common/src/build/sandbox*.ts` | Fixtures + execution |
| `common/src/build/argvNormalize.ts` | Structural fingerprint |
| `common/prompts/build/` | Generate / plausibility / judges |

## Run

```bash
bun run generate -- --max-leaves=20 --max-batches=5   # smoke
bun run generate                                      # all leaves
```

Flags: `--max-leaves=N`, `--max-batches=N`, `--skip-sandbox`. Staging DB: `local/cache/build/staging.db`.
