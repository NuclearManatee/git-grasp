# Security

- No API key required for end-user search (CLI or web).
- Seeded DB checksum is verified on search.
- High-risk recipes (risk ≥ 0.7) show a CLI caution banner; generation also denylists destructive flags such as `--force`, `--hard`, `-fd` / `-fdx`, and `--force-with-lease` (see `common/taxonomy/flag_denylist.json`).
- **CLI** telemetry is **opt-in** (default off); hard off via `DO_NOT_TRACK=1` or `GIT_GRASP_TELEMETRY=0`. **Playground** telemetry is on after Start (consent). See [observe.md](observe.md).
- Pipeline / catalog build uses `DEEPSEEK_API_KEY` only for maintainers and CI — never at query time.
