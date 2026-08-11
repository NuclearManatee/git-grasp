# CLI UX copy & style

Living **design** spec for product-facing CLI text and chalk styling (and optional emoji).  
Synced with `common/src/ux/cliStyle.ts` and the CLI apps.

Command reference: [cli.md](cli.md).

**V1 ships chalk-only.** The closed emoji set below is documented for an opt-in preview (`GIT_GRASP_EMOJI=1`); product default output has **no** emoji glyphs.

---

## Principles

1. **One job per line** — status first, explanation second, link/action last.
2. **Prefer “is …”** for toggles (`Telemetry is enabled.` not `Telemetry enabled`).
3. **Never scare without a next step** — every error/warn suggests what to do.
4. **`--json` / pipe** — plain JSON on stdout; no color chrome on structured output. Status chrome on stderr only when useful.
5. **Respect `NO_COLOR`** — chalk no-ops. Emoji only when `GIT_GRASP_EMOJI=1` (and not hard-off via `GIT_GRASP_NO_EMOJI=1`).
6. **Doctor stays dense** — diagnostics for maintainers; status glyph after the label (`DB: OK` / `DB: ✅`).
7. **Emoji sparingly (opt-in)** — only the closed set; never inside git snippets. V1 default: omitted.

---

## Locked decisions

| Topic | Decision |
|-------|----------|
| Privacy URL | Always `link` (cyan underline) |
| Update notice | Entire line `warn` (yellow), including install command |
| Telemetry off | Muted (`info` / dim) |
| Doctor status | Label first, status last: `DB: OK` (V1) / `DB: ✅` (emoji mode) |
| High-risk | `caution` (orange) |
| Hard errors (exit 2/3) | Append tip to run `git-grasp doctor` |
| Emoji in V1 | Off by default; opt-in `GIT_GRASP_EMOJI=1` |
| Help Common commands | Include `config` and `completion` |

---

## Emoji set (closed, opt-in)

Pick is intentional and small. Do not invent new ones without updating this table. **V1: omitted unless `GIT_GRASP_EMOJI=1`.**

| Emoji | Token | Meaning | Typical chalk |
|-------|-------|---------|---------------|
| ✅ | `emoji.ok` | Success, enabled, healthy, up to date | `ok` / `okMark` |
| ⚠️ | `emoji.warn` | Caution: multi-match, update, clipboard fail, high-risk | `warn` / `caution` |
| ❌ | `emoji.error` | Failure, empty search, usage error, doctor FAIL | `error` / `failMark` |
| ℹ️ | `emoji.info` | Neutral status, invite, warming/progress | `muted` / `info` |

**Not in the set:** 🎉 🔥 💡 🚀 ✨ 👍.

**Placement (emoji mode):** `{emoji} {sentence}` for confirmations; doctor uses glyph **after** the label (`DB: ✅`).

**Env:**

| Variable | Effect |
|----------|--------|
| (default) | No emoji |
| `GIT_GRASP_EMOJI=1` | Enable closed-set glyphs |
| `GIT_GRASP_NO_EMOJI=1` | Hard-off (wins over `GIT_GRASP_EMOJI`) |

---

## Color tokens

Named roles → chalk. Mirror in `common/src/ux/cliStyle.ts`.

| Token | Chalk | Use |
|-------|-------|-----|
| `brand` | `bold` | Product name in version line |
| `command` | `cyan` | Git snippets (search hits); not used inside whole-line update warn |
| `title` | `bold` | Recipe title / primary hit line |
| `ok` | `green` | Success body |
| `label` | `bold` | Short labels (`Telemetry:`) |
| `muted` | `dim` | Secondary detail, telemetry off, verbose scores |
| `info` | default | Neutral body |
| `link` | `cyan.underline` | Privacy and other URLs |
| `warn` | `yellow` | Soft caution, update available (whole line) |
| `caution` | `hex('#FF8C00')` | Uncertain match, high-risk |
| `error` | `red` | Failures, empty search, usage errors |
| `okMark` / `failMark` | green / red.bold | Doctor `OK` / `FAIL` / `MISSING` (V1) |

---

## Nielsen heuristic review

Review of the CLI surface against [Nielsen’s 10 heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/).  
Grades: **Good** / **Mixed** / **Gap**. Spec actions reflect the locked V1 design (chalk-only; emoji optional).

### 1. Visibility of system status — Mixed


| Evidence                                      | Spec action                                                    |
| --------------------------------------------- | -------------------------------------------------------------- |
| Spinner while searching; doctor/init progress | Keep. Warm line uses muted/info styling                        |
| Telemetry/update-check status commands        | `Label: on|off` with chalk; emoji only if opt-in               |
| Silent npm check failures                     | OK (privacy); status shows `(unreachable)`                     |
| First model download can feel “stuck”         | Clearer spinner / status text from embedder                    |




### 2. Match between system and the real world — Good → tighten


| Evidence                                    | Spec action                                                |
| ------------------------------------------- | ---------------------------------------------------------- |
| Natural-language query as default           | Keep                                                       |
| “Telemetry / update check / catalog” jargon | Prefer plain words in user copy; keep command names stable |
| Skill “parked” language                     | Say “does not change search results yet”                   |




### 3. User control and freedom — Good


| Evidence                                            | Spec action                                             |
| --------------------------------------------------- | ------------------------------------------------------- |
| Telemetry & update-check off by default; easy `off` | Keep; confirm with ✅/ℹ️                                 |
| Invite `d` = don’t ask again                        | Keep in invite copy                                     |
| Never auto-runs git                                 | Keep as product invariant (mention in empty-state tip?) |




### 4. Consistency and standards — Mixed


| Evidence                                                      | Spec action                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Toggle voice (“is enabled/disabled”)                          | Apply to all toggles + emoji                                                                |
| Status heads were inconsistent (`telemetry:` vs `Telemetry:`) | Always `Label: on|off` + emoji                                                              |
| Exit codes exist but are invisible in UI                      | On hard errors, optional last line: `ℹ️ Exit code 2 — see git-grasp doctor` (open question) |




### 5. Error prevention — Mixed


| Evidence                                           | Spec action                                                    |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Never executes recipes                             | Strong                                                         |
| High-risk + multi-match warnings                   | Prefix ⚠️; keep “verify before running”                        |
| `set-level` still exists but is a no-op for search | Help text must say so; consider hiding from default help later |
| Empty query → help                                 | Keep                                                           |




### 6. Recognition rather than recall — Mixed / Gap


| Evidence                                         | Spec action                                         |
| ------------------------------------------------ | --------------------------------------------------- |
| Bare `git-grasp` → help                          | Good                                                |
| Completions exist                                | Document install in help footer?                    |
| Users must remember `telemetry` / `update-check` | Help should list common commands in one short block |
| Invite says “Later: …”                           | Keep ℹ️                                             |




### 7. Flexibility and efficiency of use — Good


| Evidence                                         | Spec action                                       |
| ------------------------------------------------ | ------------------------------------------------- |
| Fast path query, `--json`, `--copy`, stdin, `-q` | Keep; no emoji on `--json` stdout                 |
| Expert env hard-offs                             | Keep undocumented-in-help is fine; live in cli.md |




### 8. Aesthetic and minimalist design — Mixed (emoji policy)


| Evidence                | Spec action                                              |
| ----------------------- | -------------------------------------------------------- |
| Dense search hit layout | Keep; emoji only on alert/risk lines, not on every title |
| Doctor walls of text    | ✅/❌ on status only                                       |
| Closed emoji set        | Enforced above — prevents decoration creep               |




### 9. Help users recognize, diagnose, recover from errors — Mixed


| Evidence                                     | Spec action                                             |
| -------------------------------------------- | ------------------------------------------------------- |
| Colored errors + doctor Fix: lines           | Prefix ❌; keep Fix: as ℹ️ indented                      |
| Empty search points to rephrase / `git help` | Prefix ❌                                                |
| Integrity/config failures are code-ish       | Prefer one human sentence + ℹ️ tip (`git-grasp doctor`) |




### 10. Help and documentation — Mixed / Gap


| Evidence                                 | Spec action                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `--help`, README Usage, cli.md, this doc | Link privacy with underline                                             |
| Help text is Commander-default dense     | Add a 4–6 line “Common commands” examples block at top of help (design) |
| No in-CLI “tips” after first run         | Out of scope for now                                                    |




### Heuristic summary


| #   | Heuristic                | Grade |
| --- | ------------------------ | ----- |
| 1   | Visibility of status     | Mixed |
| 2   | Real-world match         | Good  |
| 3   | User control             | Good  |
| 4   | Consistency              | Mixed |
| 5   | Error prevention         | Mixed |
| 6   | Recognition over recall  | Gap   |
| 7   | Flexibility / efficiency | Good  |
| 8   | Minimalist aesthetic     | Mixed |
| 9   | Error recovery           | Mixed |
| 10  | Help & docs              | Gap   |


**Biggest design bets from this review:** (A) closed emoji set for status scanning, (B) short Common-commands block on help, (C) every hard failure offers `doctor` or a concrete next step.

---



## Message inventory

IDs are stable for comments (`re: MSG.telemetry.on`).  
**Stream:** `out` = stdout, `err` = stderr.  
**Emoji column** = leading glyph (empty = none).

### Search result chrome


| ID                        | Stream | Emoji | Style                         | Copy                                                                                                  |
| ------------------------- | ------ | ----- | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `MSG.search.title`        | out    | —     | `title`                       | Recipe title / example line                                                                           |
| `MSG.search.snippet`      | out    | —     | `command` (+ `muted` comment) | Indented command lines                                                                                |
| `MSG.search.usageRule`    | out    | —     | `muted`                       | Horizontal rule                                                                                       |
| `MSG.search.usageCmd`     | out    | —     | `command`                     | Usage command                                                                                         |
| `MSG.search.desc`         | out    | —     | `info`                        | Intent / description                                                                                  |
| `MSG.search.alert.yellow` | out    | ⚠️    | `warn`                        | Several plausible matches — verify before running.                                                    |
| `MSG.search.alert.orange` | out    | ⚠️    | `caution`                     | Uncertain match — review alternatives carefully before running.                                       |
| `MSG.search.alert.red`    | out    | ❌     | `error`                       | No confident match. Try rephrasing, or run git help.                                                  |
| `MSG.search.risk`         | out    | ⚠️    | `caution`                     | High-risk recipe ({n}) — review before running.                                                       |
| `MSG.search.verbose`      | out    | —     | `muted`                       | confidence / score line                                                                               |
| `MSG.search.spinner`      | err    | —     | ora                           | Searching…                                                                                            |
| `MSG.search.copy.ok`      | err    | ✅     | `muted`                       | Copied command to clipboard.                                                                          |
| `MSG.search.copy.fail`    | err    | ⚠️    | `warn`                        | Clipboard unavailable — command is printed above.                                                     |
| `MSG.search.update`       | err    | ⚠️    | `warn` + `command` on install | A newer git-grasp is available: {latest} (you have {local}). {bun install hint \| binary release-zip hint} |
| `MSG.search.fail.tip`     | err    | ℹ️    | `muted`                       | Run git-grasp doctor if this keeps happening. *(new — for INTEGRITY/CONFIG)*                          |




### Telemetry


| ID                             | Stream | Emoji   | Style            | Copy                                                                                                    |
| ------------------------------ | ------ | ------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `MSG.telemetry.on`             | out    | ✅       | `ok` + `link`    | Telemetry is enabled. Your searches will be used to improve the product for everyone. See {PRIVACY_URL} |
| `MSG.telemetry.off`            | out    | ℹ️      | `muted`          | Telemetry is disabled. No search analytics will be sent.                                                |
| `MSG.telemetry.status.head`    | out    | ✅ or ℹ️ | `label`          | Telemetry: on | off                                                                                     |
| `MSG.telemetry.status.meta`    | out    | —       | `muted`          | indented detail lines                                                                                   |
| `MSG.telemetry.invite.blurb`   | err    | ℹ️      | `info`           | Optional analytics help improve search for everyone (cookieless; off by default).                       |
| `MSG.telemetry.invite.privacy` | err    | —       | `muted` + `link` | Privacy: {PRIVACY_URL}                                                                                  |
| `MSG.telemetry.invite.later`   | err    | —       | `muted`          | Later: git-grasp telemetry on|off|status                                                                |
| `MSG.telemetry.invite.prompt`  | err    | —       | `label`          | Enable telemetry? [y/N/d=don't ask again]                                                               |




### Update check


| ID                           | Stream | Emoji   | Style   | Copy                                                                                |
| ---------------------------- | ------ | ------- | ------- | ----------------------------------------------------------------------------------- |
| `MSG.update.on`              | out    | ✅       | `ok`    | Update check is enabled. git-grasp will occasionally check npm for a newer release. |
| `MSG.update.off`             | out    | ℹ️      | `muted` | Update check is disabled. No version checks will be sent.                           |
| `MSG.update.status.head`     | out    | ✅ or ℹ️ | `label` | Update check: on | off                                                              |
| `MSG.update.status.meta`     | out    | —       | `muted` | local / latest / checkedAt                                                          |
| `MSG.update.status.npmNewer` | out    | ⚠️      | `warn`  | npm latest={v} (newer available)                                                    |
| `MSG.update.status.npmOk`    | out    | ✅       | `ok`    | npm latest={v} (up to date)                                                         |
| `MSG.update.status.npmFail`  | out    | ℹ️      | `muted` | npm latest=(unreachable)                                                            |




### Config / skill / init / version


| ID                  | Stream | Emoji | Style            | Copy                                                                       |
| ------------------- | ------ | ----- | ---------------- | -------------------------------------------------------------------------- |
| `MSG.config.usage`  | err    | ❌     | `error`          | Usage: git-grasp config show|path                                          |
| `MSG.skill.cleared` | out    | ℹ️    | `info` + `muted` | Preferred skill cleared. (Does not change search results yet.)             |
| `MSG.skill.set`     | out    | ℹ️    | same             | Preferred skill set to {name} ({n}). (Does not change search results yet.) |
| `MSG.init.warm`     | out    | ℹ️    | `muted`          | Downloading/warming the embedding model…                                   |
| `MSG.init.warmMock` | out    | ℹ️    | `muted`          | Warming embeddings (mock)…                                                 |
| `MSG.init.ready`    | out    | ✅     | `ok`             | Ready. Search will use the local model and catalog.                        |
| `MSG.version.brand` | out    | —     | `brand`          | git-grasp {semver}                                                         |
| `MSG.version.meta`  | out    | —     | `muted`          | catalog · schema · db                                                      |




### Doctor

| ID | V1 (chalk) | Emoji mode | Pattern |
|----|------------|------------|---------|
| `MSG.doctor.ok` | green `OK` | `✅` after label | `DB: OK …` / `DB: ✅ …` |
| `MSG.doctor.fail` | red `FAIL` / `MISSING` | `❌` after label | `DB: FAIL …` / `DB: ❌ …` |
| `MSG.doctor.fix` | muted | muted + optional info glyph | `  Fix: …` |

```text
DB: OK (7428082e30f0…) schema v9 catalog=v5
  Fix: bun run ship   ← only on failure paths
```

### Generic errors

| ID | Stream | Style | Copy |
|----|--------|-------|------|
| `MSG.error.generic` | err | `error` | {human message} |
| `MSG.error.usage.*` | err | `error` | Usage: git-grasp … |
| `MSG.search.fail.tip` | err | `muted` | Run git-grasp doctor if this keeps happening. |

### Help

```text
Common commands:
  git-grasp "undo last commit keep files"
  git-grasp doctor
  git-grasp init
  git-grasp config show
  git-grasp telemetry status
  git-grasp update-check status
  git-grasp completion bash

Full reference: docs/cli.md
```

No emoji in the help command list.

---

## Layout sketches (V1 chalk-only)

### Search hit + soft alert

```text
git reset --soft HEAD~1
  git reset --soft HEAD~1
  ────────────────────────
Several plausible matches — verify before running.   ← yellow
```

### Empty search

```text
No confident match. Try rephrasing, or run git help.   ← red
```

### Telemetry on

```text
Telemetry is enabled. Your searches will be used to improve the product for everyone. See https://…   ← green + link
```

### Update notice (stderr)

```text
A newer git-grasp is available: 0.2.0 (you have 0.1.0). Update with: bun add -g git-grasp@latest   ← whole line yellow (Bun/npm)
A newer git-grasp is available: 0.2.0 (you have 0.1.0). Download the latest release zip…          ← binary install hint
```

### Doctor excerpt

```text
git-grasp 0.1.0
catalog v5 (941 recipes) · schema v9 · db 7428082e30f0
sqlite-vec: OK …
DB: OK …
Model: MISSING — …
  Fix: run git-grasp init
```

---

## Decisions (resolved)

- [x] Privacy URL: always `link` (underline cyan)
- [x] Update notice: whole line `warn` (including install command)
- [x] Telemetry **off**: muted
- [x] Doctor: status **last** (`DB: OK` / `DB: ✅`)
- [x] High-risk: `caution` (orange)
- [x] On exit code 2/3: append tip to run `git-grasp doctor`
- [x] V1: no emoji by default; opt-in `GIT_GRASP_EMOJI=1` (`GIT_GRASP_NO_EMOJI=1` hard-off)
- [x] Help Common commands: include `config` and `completion`

---

## Reviewer notes

```text
<!-- note: MSG.telemetry.on — … -->
```

---

## Implementation map

| Spec | Code |
|------|------|
| Tokens + emoji helpers | `common/src/ux/cliStyle.ts` |
| Shared MSG formatters | `common/src/ux/messages.ts` |
| Search formatting | `common/src/ux/format.ts` |
| Confirmations / status / help | `apps/cli/src/program.ts` |
| Copy / update notice | `apps/cli/src/runSearch.ts`, `common/src/lib/updateCheck.ts` |
| Invite | `common/src/lib/telemetry/invite.ts` |
| Doctor | `apps/cli/src/doctor.ts` |
| Web playground mirror | `apps/web/src/components/playground/Playground.tsx` — see [web.md](web.md) |

## Web playground mirror

The marketing playground reuses search formatting and shared MSG helpers:

| MSG / surface | Playground |
|---------------|------------|
| Search alerts / risk / hit layout | Yes — `formatSearchResult` |
| `MSG.telemetry.on` | Printed on successful Start |
| `MSG.init.ready` / warm | Yes |
| `MSG.skill.*` | `set-level` (parked) |
| `MSG.search.copy.*` | `-c` / `--copy` via Clipboard API |
| `telemetry status` | Always **on** after Start |
| Doctor / update-check / completion / invite | CLI-only |

Details and e2e: [web.md](web.md).

## Visual review gallery

Generated locally (gitignored under `local/`):

```bash
bun local/cli-ux-review/capture.ts
# then serve local/cli-ux-review on http://127.0.0.1:8765
```

Screenshots: `local/cli-ux-review/screenshots/`.
