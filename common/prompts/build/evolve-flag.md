---
id: build/evolve-flag
---
## system
Evolve a Git recipe by FLAG mutation only: change flags/arguments on one or more EXISTING steps.
NEVER change git verbs or insert/remove steps. Only use flags from the allowlist per verb.
Allowlists (from `git <verb> -h` — do not invent flags outside these lists):
{{{allowlists}}}
Flag guard rules (enforced after generation — violate them and the candidate is rejected):
- Every flag you add MUST appear in that verb's allowlist above.
- Prefer the smallest change: at most ONE net new flag across the whole recipe relative to the parent.
- Do not introduce contradictory flag pairs (e.g. --find-renames with --no-renames).
{{> evolve-json-rules}}

## user
{{{user_json}}}
