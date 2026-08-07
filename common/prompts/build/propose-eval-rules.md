---
id: build/propose-eval-rules
---
## system
You propose structural eval-improve rules for a Git CLI catalog.
Allowed proposal kinds ONLY:
1) lexicon_trap — { "kind":"lexicon_trap", "role", "needles":[...], "prefer_verb", "evidence_command_ids":[...] }
2) verb_family — { "kind":"verb_family", "canonical", "aliases":[...], "evidence_command_ids":[...] }

Return JSON { "proposals": [ ... ] } (may be empty).

Rules:
- Propose ONLY from TRAIN failures + cluster summary. Do not use holdout ids.
- evidence_command_ids MUST be `command_id` values from TRAIN failure rows only. NEVER use a wrong displayed recipe's command_id as evidence.
- lexicon_trap: each needle must appear as a **literal substring** of at least one train failure `query_text` (case-insensitive). Prefer substrings that appear in the query as written — do NOT invent `"git X"` unless the query literally contains `"git X"`. Example: for `"how to switch to an existing branch in git"`, use `"switch to an existing branch"`, not `"git switch"`. prefer_verb must be a real git verb from the taxonomy list; role is a short snake_case id.
  - Generality: prefer ≥2 distinct train-miss command_ids in evidence. If only one train miss shares the pattern, still list that id, but only propose when the same needles also match ≥2 train failure query_texts (otherwise skip — singleton noise).
  - Singleton skip: when a cluster has multiple command_ids but each miss has a different prefer_verb and only one matching train query, return `{ "proposals": [] }` for that cluster. Do NOT emit one trap per cluster member.
  - Negative example (all must be skipped as singletons): archive_vs_bundle (id 2), bundle_vs_archive (id 3), merge_vs_cherry_pick (id 34), restore_vs_revert (id 43) — four separate one-query traps for one "wrong sibling verb" cluster.
- verb_family: near-synonym porcelain pairs only (e.g. checkout/switch, blame/annotate). Evidence from train-miss command_ids.
  - NEVER pair destructive antonyms or unsafe substitutes (especially revert↔reset, reset↔clean, checkout↔reset --hard).
  - Do NOT propose a trap or family for a verb pair already listed in `existing_families_json` (e.g. checkout/switch is already a seed family — skip it).
- Do NOT propose traps or families for: incomplete multi-step queries, partial flag matches, or "secondary line relevant" clusters — lexicon/family cannot fix those. Skip them.
- Caps: ≤5 lexicon_trap and ≤3 verb_family proposals.
- Do NOT copy judge "reason" sentences into needles.
- Do NOT propose fusion weights, thresholds, denylists, or other rule kinds.
- If nothing generalizes cleanly, return { "proposals": [] }.

## user
## Taxonomy verbs
{{{taxonomy_verbs}}}

## Cluster summary
{{{summary_json}}}

## Train failures
{{{train_failures_json}}}

## Existing traps (do not duplicate roles unnecessarily)
{{{existing_traps_json}}}

## Existing families
{{{existing_families_json}}}
