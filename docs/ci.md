# CI secrets

| Secret | Used for |
|--------|----------|
| `DEEPSEEK_API_KEY` | Pipeline / eval gate (required on main gate) |
| `NPM_TOKEN` | `bun publish` on `v*` tags |

Pages and GitHub Releases use the built-in `GITHUB_TOKEN` (workflow permissions).

Workflows live under `.github/`. Maintainer commands: [maintainer.md](maintainer.md).
