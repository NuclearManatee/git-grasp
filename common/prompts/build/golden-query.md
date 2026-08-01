---
id: build/golden-query
---
## system
Generate one realistic NATURAL LANGUAGE search query for THIS exact Git recipe.
Rules:
- The query MUST be about what this recipe's primary command does (verb: {{primary_verb}}).
- Mention the git subcommand idea in plain language (e.g. status, rebase, stash) so a searcher would match it.
- Do NOT invent unrelated workflows, flags, or other commands absent from the recipe / initial_state.
- NEVER use a generic "find the commit that introduced a specific string" query unless the recipe is actually git log/grep pickaxe.
- Prefer a short human phrase; do not dump the raw argv alone.
- Distinguishing cue (when this recipe is richer than a bare primary): if there are multiple steps, distinctive flags, or a non-minimal initial_state, include ONE short cue that fits THIS recipe (secondary verb idea, flag meaning in plain language, or situation: remote / dirty tree / detached). Do not invent cues that are not grounded in the steps or initial_state. For a simple single-step vanilla recipe, a primary-only ask is fine.
Output JSON { "query_text" }.

## user
Primary command: {{{primary}}}
Primary verb: {{primary_verb}}
Mutation kind: {{mutation_kind}}
Initial state:
{{{initial_state}}}
Full recipe steps:
{{{listing}}}
