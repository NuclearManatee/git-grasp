# EVOLVE

**Summary:** Pull opted-in OBSERVE events from Umami, denoise them, rebuild search journeys, and emit an EXPAND **feeder**. Default run chains into EXPAND triage/fill; use `--no-chain` to stop at the feeder.

```mermaid
flowchart TB
  Pull[PULL]
  Filter[FILTER]
  Thread[THREAD]
  Feeder[feeder train/holdout]
  Expand[EXPAND triage]
  Pull --> Filter --> Thread --> Feeder
  Feeder -->|default| Expand
  Feeder -->|no-chain| Stop[stats only]
```

Not the same as recipe **mutation** helpers (`evolveGuards` / `evolve-flag|state|composition` prompts) used inside GENERATE/EXPAND.

## Cloud send vs local pull

| Direction | Default host | Notes |
|-----------|--------------|--------|
| OBSERVE **send** (CLI/web) | Umami Cloud (baked in `defaults.ts`) | Opt-in CLI / Start playground |
| EVOLVE **pull** | `http://127.0.0.1:3001` | Local Docker e2e; override with `GIT_GRASP_UMAMI_*` for Cloud |

Do not assume send and pull share the same host unless you set env for both.

## Stages

| Step | Behavior |
|------|----------|
| **PULL** | Incremental Umami events since `local/evolve/cursor.json`. Paginates pages; uses `last_event_id` for boundary dedupe. Cursor advances **only after** durable feeder/stats write. Host defaults to loopback; override with `GIT_GRASP_UMAMI_*`. |
| **FILTER** | Keep `cli_search` / `web_cli_search`; drop mock, empty, burst repeats, PII/spam; one `catalog_version` per run. |
| **THREAD** | Group by CLI `session_id` or Umami session/visit/visitor; gap **45s** (soft near-edit merge to **90s**); cap length/entropy; labels `satisfied` / `weak` / `miss` / `abandon`. Optional LLM confirm for weak/abandon (**`--llm-label` only** — bare `OPENAI_API_KEY` does not auto-enable). |
| **Feeder** | Miss-like journeys only → EXPAND-compatible failure shape (`source: 'observe'`, `correctExists: false` when no expected id). **80/20** hash split: train → chain, holdout → post-chain hit-rate stat. |

## Ship gates

- `--ship` bumps corpus version and promotes staging → product **only after** leaf held-out + regression gates (or `heldoutOk` / `heldoutGate` / `leaves` supplied by caller).
- `--ship-unsafe` skips those gates (escape hatch; do not use for catalog merges that must meet CLAUDE.md).

## Artifacts

| Path | Tracked? |
|------|----------|
| `local/evolve/**` (raw, feeder, cursor, stats JSON) | No (gitignored via `local/`) |
| [`docs/evolve/latest.md`](./evolve/latest.md) | Yes — aggregate counts only |

Corpus version bump uses integer `vN` via `writeCorpusVersion` when chaining with `--ship` (or `allowVersionBump`).

## Run

```bash
# Local Umami (e2e)
docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
bun run evolve:seed-umami
export GIT_GRASP_UMAMI_HOST=http://127.0.0.1:3001
# …website id + token from seed output

bun run evolve -- --no-chain
bun run evolve                    # feeder + EXPAND triage chain
bun run evolve -- --ship          # chain + promote when held-out/regression green
bun run evolve -- --ship-unsafe   # promote without catalog gates
bun run evolve:render-latest
```

Flags: `--no-chain`, `--llm-label`, `--ship`, `--ship-unsafe`, `--catalog-version=N`.

## Code

| Path | Role |
|------|------|
| `apps/pipeline/src/evolve/run.ts` | CLI entry |
| `common/src/evolve/` | PULL / FILTER / THREAD / feeder / chain |
| `common/prompts/evolve/confirm-label.md` | Optional label confirm |
| `test/unit/evolve-*.test.ts` | Unit |
| `test/integration/evolve-umami.test.ts` | Docker Umami e2e |

## OBSERVE input

CLI events include opaque `session_id` (minted on telemetry enable, cleared on disable). See [observe.md](observe.md).
