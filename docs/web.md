# Web (`apps/web`)

Astro marketing site plus an in-browser playground (Xterm + sql.js catalog + Transformers.js BGE-small).

Lifecycle: **SEARCH** ([search.md](search.md)) + **OBSERVE** ([observe.md](observe.md)).

## Features

- Landing / docs pages for the product.
- Playground: same hybrid search path as CLI via `@git-grasp/common/browser` (description embeddings + FTS; title + description hits). Search hit chrome reuses `formatSearchResult` ([cli-ux.md](cli-ux.md)).
- Catalog pack: `public/catalog/web-catalog.db` produced by `bun run web:pack` (also copies `sql.js` WASM to `public/vendor/sql.js/` for same-origin loading).

## Playground UX contract

- **Start = telemetry on.** After a successful load, the terminal prints `MSG.init.ready` then `MSG.telemetry.on` (privacy URL). Footer and overlay also disclose cookieless analytics.
- **Supported REPL commands:** natural-language query, `-v` / `--verbose`, `-c` / `--copy`, `set-level` (parked preference; no retrieval effect), `telemetry on|off|status` (status always **on**; `off` explains withdrawal — leave playground / use CLI), `help`.
- **CLI-only (not in playground):** `doctor`, `update-check`, `completion`, `config`, `init`, `--json`, npm update notices.
- Shared copy lives in `common/src/ux/messages.ts` so CLI and playground stay aligned.

## Playground / e2e

```bash
bun run ship          # if DB missing
bun run web:pack      # regenerate catalog pack
bun run web:dev

bun run web:build
bun run web:e2e       # Playwright a11y + tracking + playground-ux
```

Playground query params: `?mock=1` (mock embeddings), `?optin=1` (force download overlay).

E2e suites: `apps/web/e2e/a11y.spec.ts`, `tracking.spec.ts`, `playground-ux.spec.ts`, `hydrate.spec.ts`.
Terminal assertions use `window.__ghPlaygroundDump`.

**Why Playwright missed the createRoot bug:** default `web:e2e` serves **`astro preview`** (production Rollup bundle). Dev-only Vite optimizer races can leave `react-dom/client` as raw CJS so islands never mount — preview still works. Catch that with:

```bash
bun run web:build && bun run web:e2e          # preview (default)
bun --filter @git-grasp/web e2e:dev           # starts astro dev + hydrate.spec.ts
```

`reuseExistingServer` is **off** so a broken local `astro dev` cannot silently satisfy preview e2e.

Optional local Umami (overrides baked Cloud defaults via `PUBLIC_UMAMI_*` in `.env` — see `.env.example`):

```bash
docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
# PUBLIC_UMAMI_SCRIPT_URL=http://127.0.0.1:3001/script.js
# PUBLIC_UMAMI_WEBSITE_ID=<seeded id>
```

Without env overrides, the Site uses baked Cloud script + website id (same as CLI OBSERVE defaults).

Umami events: `web_cli_load`, `web_cli_search` (cookieless; include `schema_version` / `catalog_version` when available). Privacy: [observe.md](observe.md), site `/privacy`.
