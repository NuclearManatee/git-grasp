# Web (`apps/web`)

Astro marketing site plus an in-browser playground (Xterm + sql.js catalog + Transformers.js BGE-small).

Lifecycle: **SEARCH** ([search.md](search.md)) + **OBSERVE** ([observe.md](observe.md)).

## Features

- Landing / docs pages for the product.
- Playground: same hybrid search path as CLI via `@git-grasp/common/browser` (description embeddings + FTS; title + description hits).
- Catalog pack: `public/catalog/web-catalog.db` produced by `bun run web:pack`.

## Playground / e2e

```bash
bun run ship          # if DB missing
bun run web:pack      # regenerate catalog pack
bun run web:dev

bun run web:build
bun run web:e2e       # Playwright a11y + tracking
```

Playground query params: `?mock=1` (mock embeddings), `?optin=1` (force download overlay).

Optional local Umami:

```bash
docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
```

Umami events: `web_cli_load`, `web_cli_search` (cookieless). Privacy: [observe.md](observe.md), site `/privacy`.
