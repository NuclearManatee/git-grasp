# git-grasp

**Natural-language search for Git recipes** — offline on your machine. Embeddings and full-text search run locally. git-grasp **never runs Git for you** and needs **no API key to search**.

Try it in the browser: [git-grasp.cremaschi.dev](https://git-grasp.cremaschi.dev)

## Install

Requires **[Bun](https://bun.sh) ≥ 1.3.14**.

```bash
bun add -g git-grasp
git-grasp doctor
```

On first real search (or after `git-grasp init`), the embedding model downloads from Hugging Face into your user cache.

### Prefer a standalone binary?

Pre-built zips (no Bun required) are on [GitHub Releases](https://github.com/NuclearManatee/git-grasp/releases/latest):

| Platform | Asset |
|----------|--------|
| Linux x64 | `git-grasp-linux-x64.zip` |
| Windows x64 | `git-grasp-windows-x64.zip` |

Unzip, keep the `common/` folder beside `git-grasp` (or `git-grasp.exe`), and run from that directory. Checksums: `SHA256SUMS` on each release.

## Usage

```bash
git-grasp "undo last commit but keep my files"
git-grasp search "create a branch" --verbose
git-grasp --json "stash my changes"
git-grasp --copy "rename a branch"
git-grasp init
git-grasp --version
```

| Flag | Meaning |
|------|---------|
| `-v, --verbose` | Show confidence / channel scores |
| `-c, --copy` | Copy the top recipe example to the clipboard |
| `--json` | Machine-readable JSON on stdout |
| `-q, --quiet` | No spinner; skip telemetry invite |

Pipe a query from stdin:

```bash
echo "undo last commit keep files" | git-grasp
```

## Common commands

| Command | Purpose |
|---------|---------|
| `git-grasp doctor` | Check catalog DB, sqlite-vec, model cache, config |
| `git-grasp init` | Doctor checks + warm the embedding model |
| `git-grasp config show` | Show resolved config |
| `git-grasp telemetry on\|off\|status` | Opt-in usage analytics (**off** by default) |
| `git-grasp update-check on\|off\|status` | Opt-in npm update notices (**off** by default) |
| `git-grasp completion bash` | Shell completions (`zsh`, `fish`, `powershell` too) |

## Privacy

Telemetry is **off by default**. Hard off: `DO_NOT_TRACK=1` or `GIT_GRASP_TELEMETRY=0`.

Details: [Privacy policy](https://git-grasp.cremaschi.dev/privacy)

## More documentation

- Full CLI reference (exit codes, env vars, UX): [apps/cli/README.md](https://github.com/NuclearManatee/git-grasp/blob/main/apps/cli/README.md)
- How search works: [docs/SEARCH.md](https://github.com/NuclearManatee/git-grasp/blob/main/docs/SEARCH.md)
- Repository / development: [README.md](https://github.com/NuclearManatee/git-grasp/blob/main/README.md)

## License

MIT © [NuclearManatee/git-grasp](https://github.com/NuclearManatee/git-grasp)
