# Web (`apps/web`)

Astro marketing site plus an in-browser playground (Xterm + sql.js catalog + Transformers.js BGE-small). Pages: `/`, `/examples`, `/privacy`. Same hybrid search as the CLI via `@git-grasp/common/browser`. Search hit chrome reuses `formatSearchResult`.

Algorithm: [docs/search.md](../../docs/search.md). Telemetry consent: [docs/observe.md](../../docs/observe.md) and site `/privacy`. Shared copy: [docs/cli-ux.md](../../docs/cli-ux.md). Catalog build: [pipeline README](../pipeline/src/README.md). Pages deploy: [docs/ci.md](../../docs/ci.md). CSP / WASM integrity: [docs/security.md](../../docs/security.md).

## Run

From the repo root:

```bash
bun run ship          # if common/data/git-commands.db is missing
bun run web:pack
bun run web:dev
```

`bun run web:build` produces the production bundle (`astro preview` is what default e2e serves).

## Catalog pack

`bun run web:pack` (`apps/web/scripts/export-web-pack.ts`) requires a seeded `common/data/git-commands.db`. It writes:

- `public/catalog/web-catalog.db` + `.sha256`
- sql.js WASM under `public/vendor/sql.js/` (same-origin)
- `src/lib/assetSizes.ts` (generated; do not edit by hand)

## Playground

Query params: `?mock=1` (mock embeddings), `?optin=1` (force download overlay).

REPL: natural-language query, `-v` / `--verbose`, `-c` / `--copy`, `set-level` (parked; no retrieval effect), `telemetry on|off|status` (status is always **on** after Start; `off` explains withdrawal — leave the playground or use the CLI), `help`.

CLI-only (not in the playground): `doctor`, `update-check`, `completion`, `config`, `init`, `--json`, npm update notices.

After a successful Start the terminal prints `MSG.init.ready` then `MSG.telemetry.on`. Shared copy lives in `common/src/ux/messages.ts`.

## E2e

Suites: `apps/web/e2e/a11y.spec.ts`, `tracking.spec.ts`, `playground-ux.spec.ts`, `hydrate.spec.ts`. Terminal assertions use `window.__ghPlaygroundDump`.

Default `bun run web:e2e` serves **`astro preview`** (production Rollup bundle). Dev-only Vite optimizer races can leave `react-dom/client` as raw CJS so islands never mount — preview still works. Catch that with:

```bash
bun run web:build && bun run web:e2e          # preview (default)
bun run web:e2e:dev                           # astro dev + hydrate.spec.ts
```

`reuseExistingServer` is **off** so a broken local `astro dev` cannot silently satisfy preview e2e.

## PostHog (optional)

Site snippet env (`PUBLIC_POSTHOG_*` in `.env` — see [`.env.example`](./.env.example)) is the public project key. EVOLVE pull uses `GIT_GRASP_POSTHOG_PROJECT_ID` + `GIT_GRASP_POSTHOG_PERSONAL_API_KEY` against the query API host. Send vs pull: [docs/observe.md](../../docs/observe.md).

Without a project key, the site does not load PostHog (same as CLI OBSERVE send).

Local telemetry / EVOLVE e2e uses Docker PostHog (not Cloud):

```bash
docker compose -f apps/web/docker-compose.posthog.yml --profile e2e up -d
bun run evolve:seed-posthog
bun run test:telemetry-e2e
bun run test:evolve-e2e
```

Playwright `tracking.spec.ts` still asserts `window.__ghTrackQueue` (CI does not start PostHog). Point `PUBLIC_POSTHOG_HOST` at `http://127.0.0.1:8010` only when you want the playground snippet to hit the local stack.
