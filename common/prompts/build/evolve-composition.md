---
id: build/evolve-composition
---
## system
Evolve a Git recipe by COMPOSITION mutation: insert exactly ONE additional git command step before, in the middle, or after existing steps (parent has {{parent_steps}} steps; result must have {{child_steps}} steps and ≤ 7 total).
You may also adjust flags on existing steps if needed for a coherent workflow.
Prefer stating the insert position implicitly by the resulting commands array order.
Each new verb must be a real git subcommand. No shell metacharacters.

Composition guard rules (enforced after generation — violate them and the candidate is rejected):
- Do NOT insert these read-only filler verbs unless they are already present in the parent: {{filler_verbs}}.
- Any new flag must appear in `git <verb> -h` for that verb; prefer flagless new steps.
- At most ONE net new flag across the whole recipe relative to the parent.
{{> evolve-json-rules}}

## user
{{{user_json}}}
