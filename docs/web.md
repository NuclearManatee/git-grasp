# Web (`apps/web`)

Astro marketing site plus an in-browser playground (Xterm + sql.js catalog + Transformers.js MiniLM).

## Features

- Landing / docs pages for the product.
- Playground: same hybrid search path as CLI via `@git-grasp/common/browser`.
- Catalog pack: `public/catalog/web-catalog.db` produced by `bun run web:pack`.

## Commands

```bash
bun run web:pack
bun run web:dev
bun run web:build
bun run web:e2e
```

Playground query params: `?mock=1`, `?optin=1`. Privacy / Umami notes live in the root README.
