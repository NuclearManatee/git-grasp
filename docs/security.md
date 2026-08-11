# Security

## End-user search

- No API key required for CLI or web search.
- Seeded DB checksum is verified on every search; CLI and web also check `schema_version` / `search_algorithm_version`.
- The tool **never executes** Git recipes for the user.
- High-risk recipes (**risk ≥ 0.7**) show a CLI caution banner; generation denylists destructive flags such as `--force`, `--hard`, `-fd` / `-fdx`, and `--force-with-lease` (`common/taxonomy/flag_denylist.json`).
- **CLI** telemetry is **opt-in** (default off); hard off via `DO_NOT_TRACK=1` or `GIT_GRASP_TELEMETRY=0`. **Playground** telemetry is on after Start (session consent). See [observe.md](observe.md).
- Optional npm **update-check** is off by default; version strings are semver-sanitized before display.

## Build / catalog (maintainers)

- Pipeline / catalog build uses `DEEPSEEK_API_KEY` only for local maintainer runs — never at query time and not required by GitHub workflows.
- Recipe validation sandbox is **argv-only Git** (no freeform shell); shell metas are refused.
- Git verb parsing treats `git -C` / `git -c` like the sandbox so allowlists are not skipped.
- `GIT_GRASP_TLS_INSECURE=1` is refused in CI.

## Web / supply chain

- Playground packs a checksummed catalog; sql.js WASM is integrity-checked where shipped.
- CSP is set in the Astro layout; deploy hosts should also apply `apps/web/public/_headers.example`.
- Release CI runs `ci-audit` before binaries / npm publish. See [ci.md](ci.md).

## Threat model (brief)

| Actor | Assets | Boundary |
|-------|--------|----------|
| End user (CLI) | Local DB, config, clipboard, queries | Offline search; optional Umami; optional update check |
| End user (web) | Browser, queries after Start | Static + sql.js + HF model; Umami |
| Maintainer / CI | Host + LLM keys | Sandbox validates recipes at build time |
| Attacker | Tampered catalog/WASM, MITM registry, poisoned advice | GH Pages + npm + HF CDNs |
