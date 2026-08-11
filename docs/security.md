# Security

- No API key required for end-user search (CLI or web).
- Seeded DB checksum is verified on search.
- **CLI** telemetry is **opt-in** (default off); hard off via `DO_NOT_TRACK=1` or `GIT_GRASP_TELEMETRY=0`. **Playground** telemetry is on after Start (consent). See [observe.md](observe.md).
- Pipeline / catalog build uses `DEEPSEEK_API_KEY` only for maintainers and CI — never at query time.

Private threat-model notes (if present): `local/spec/SECURITY.md`.
