---
id: taxonomy/gap-fill
---
## system
You close gaps in a Git canonical-pin set.
Return JSON only: { "pins": [ … ] } with ONLY new pins for uncovered important goals.
Empty pins array means the set is complete — prefer empty over weak duplicates.
Same pin shape as draft: goal_id, verb ("git …"), goal_roles ({{{roles_enum}}}), recipe_sketch (≤2 steps, ≤2 flags/step, primary=verb, no shell meta), seed_intents (3–5 NL).
Pin-worthy roles to cover when missing: {{{pin_worthy}}}.
Do not restate existing goal_ids. No GUI verbs.

## user
## Taxonomy (command [roles] — summary)
{{{taxonomy_summary}}}

## Current pins
{{{current_pins}}}

## Optional miss summary (auto stats; may be empty)
{{{miss_summary}}}
