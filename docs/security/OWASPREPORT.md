# OWASP security report — git-grasp

**Last updated:** 2026-08-18  
**Sources consolidated:** `local/polish/security.md` (2026-08-11), `local/security/owasp-remaining-2026-07-26.md`, `local/spec/SECURITY.md` (normative draft; partially superseded).

**Status legend**

| Status | Meaning |
|--------|---------|
| **Addressed** | Fixed in code or closed in production |
| **Mitigated** | Partial fix or accepted residual with compensating control |
| **Disregarded** | Out of scope, superseded, or stale reference |

---

## Executive summary

No P0 RCE on the CLI/web **query path**. Residual risk is product-safety (high-risk recipe messaging), maintainer/build pipeline hardening, and deploy-time headers (Cloudflare). Application code fixes from the July 2026 OWASP follow-up (R2–R4) are landed. Ops items (R1, R7) depend on production header verification.

---

## Polish review findings (P1–P3)

| ID | Sev | Category | Problem | Status | Notes |
|----|-----|----------|---------|--------|-------|
| P1-a | P1 | Unsafe advice | High-risk banner used `> 0.7`; recipes at exactly 0.7 skipped caution | **Addressed** | `common/src/ux/format.ts` uses `topRisk >= 0.7` |
| P1-b | P1 | Catalog safety | Empty denylist; dangerous verbs in allowlist | **Mitigated** | `flag_denylist.json` lists destructive flags; `filter-branch` / `credential` remain in `ALLOWED_SUBCOMMANDS` — taxonomy may still map risky verbs |
| P2-a | P2 | Sandbox CWE-78 | Freeform shell in sandbox | **Mitigated** | Git lines use argv-only `spawnGit`; non-git lines still use `shell: true` in build-time sandbox only |
| P2-b | P2 | Validation gap | `git -C …` skipped verb allowlist in validator | **Mitigated** | Schema validator treats `-C` as flag token; sandbox tokenizes git argv separately — edge cases may remain |
| P2-c | P2 | Terminal injection | npm version unsanitized in update notice | **Mitigated** | `compareSemver` parses numeric core; remote version displayed as string from npm JSON — low injection risk in terminal |
| P2-d | P2 | Supply chain | sql.js WASM without checksum | **Addressed** | Catalog pack + integrity checks in web playground (`WEB_PACK_SHA256`, export script) |
| P2-e | P2 | CSP | Meta CSP + `unsafe-inline` only | **Mitigated** | Astro layout CSP + `apps/web/public/_headers.example` for edge deploy |
| P2-f | P2 | Consent UX | Playground “telemetry off” no-op mid-session | **Mitigated** | Documented: withdrawal = leave playground / use CLI (default off); no mid-session toggle by design |
| P3-a | P3 | Dead security test | `no-child-process` walked `.js` only | **Addressed** | `test/unit/no-child-process.test.ts` walks `.ts` and `.js` |
| P3-b | P3 | TLS insecure env | `GIT_GRASP_TLS_INSECURE=1` enables MITM | **Mitigated** | Still honored locally in `llm.ts` for maintainer debugging; **documented** as refused in CI — enforce in workflow env if not already |
| P3-c | P3 | Docs drift | Missing tracked SECURITY spec | **Addressed** | This folder: `README.md` + `OWASPREPORT.md` |
| P3-d | P3 | Risk scoring | force/clean scored 0.5–0.7 vs banner at 0.7 | **Mitigated** | Banner at ≥0.7; catalog risk scores are informational |

**Already mitigated (polish review):** no `child_process` on search path; `spawnGit` with `shell: false`; shell metas blocked in schema; config ACL 0600; CLI telemetry default off + DNT; Start = playground consent; DB checksums; CI audit; ANSI sanitize on recipe fields.

---

## OWASP remaining items (R1–R8)

| ID | Prior | Status | Notes |
|----|-------|--------|-------|
| **R1** | Medium — no real HTTP security headers on GH Pages | **Mitigated** | Cloudflare Transform Rules documented in `local/GITHUBSETUP.md`. **Closed when** production curl verifies CSP/HSTS/X-Frame. |
| **R2** | Low — optional analytics script SRI | **Addressed** | Production remote script refused without integrity env (Umami era); **Disregarded** for PostHog snippet — current stack uses PostHog EU with public project key |
| **R3** | Low — FNV fingerprint | **Addressed** | Truncated SHA-256 (16 hex) via Web Crypto |
| **R4** | Low — ContrastDemo `innerHTML` | **Addressed** | `textContent` + `createElement` / `replaceChildren` |
| **R5** | Info — `bun audit` registry flake | **Disregarded** | Fail-closed on audit is acceptable |
| **R6** | Info — in-memory track queue | **Disregarded** | Slim payloads; acceptable |
| **R7** | Ops — Cloudflare Full (strict) | **Mitigated** | Verify after DNS cutover |
| **R8** | Legal — Italian privacy translation | **Disregarded** | Product/legal; out of engineering scope |

### R1 verification (deploy)

```bash
curl -sI https://git-grasp.cremaschi.dev | findstr /I "content-security x-frame strict-transport"
```

Until that passes, treat R1 as **docs-ready / not yet live**.

---

## STRIDE / OWASP control map (from normative spec)

Items below come from `local/spec/SECURITY.md`. Stale references (GROQ API, Umami, `git-help` naming) are **Disregarded** where the product now uses **DEEPSEEK**, **PostHog**, and **git-grasp**.

| Control area | Requirement | Status | Notes |
|--------------|-------------|--------|-------|
| A03 Injection | No shell execution on user query path | **Addressed** | Product invariant; schema rejects shell metas |
| A02 Integrity | SHA-256 DB + model verify | **Addressed** | CLI + web pack checksums |
| A08 Supply chain | Lockfile + audit on release | **Addressed** | `ci-audit` in release gate |
| LLM01 Prompt injection | Untrusted docs/queries in builder | **Mitigated** | Allowlist + sandbox at build time; not query-time LLM |
| LLM02 Insecure output | Malicious catalog rows | **Mitigated** | Validation pipeline + drop reports |
| Secrets | No keys in catalog/DB/logs | **Addressed** | `DEEPSEEK_API_KEY` maintainer-only |
| Improve-loop allowlist | Agent may not edit golden answers | **Addressed** | Documented in ARCHITECTURE + pipeline README |
| Security tests | Automated no-spawn, ANSI strip, checksum fail | **Addressed** | `test/unit/no-child-process.test.ts` + integration coverage |

---

## Pre-release checklist (from polish review)

| Item | Status |
|------|--------|
| High-risk banner ≥0.7 / flag-based warnings | Done |
| Expand flag denylist; review force/clean/filter-branch recipes | Partial — denylist populated; verb allowlist review ongoing |
| Sandbox fixtures + argv-only git | Done for git lines |
| Sanitize update-check versions | Mitigated via semver parse |
| Checksum sql.js WASM / catalog pack | Done |
| Deploy CSP headers (edge + meta) | Mitigated — verify R1 in prod |
| Clarify playground telemetry withdrawal | Documented in OBSERVE + privacy |
| Fix `no-child-process` `.ts` walk | Done |
| No `GIT_GRASP_TLS_INSECURE` in CI | Documented — verify workflow env |
| Smoke: doctor checksum fail; tampered web DB rejected | Manual / e2e |
| `ci-audit` green on release tag | CI gate |

---

## Verdict

**Ship-ready** for end-user search with documented caveats: verify Cloudflare headers (R1/R7), continue catalog verb/risk review (P1-b), and treat maintainer TLS bypass as local-only.

For user-facing boundaries see [README.md](README.md). For branch/CI gates see [BRANCHING.md](../BRANCHING.md) and [.github/README.md](../../.github/README.md).
