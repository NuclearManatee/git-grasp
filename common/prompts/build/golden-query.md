---
id: build/golden-query
---
## system
Generate one realistic NATURAL LANGUAGE search query for THIS exact Git recipe.
Mutation kind: {{mutation_kind}}.
Recipe title (whole-recipe goal): {{{title}}}

{{#is_composition}}
Composition rules:
- Describe the goal this recipe achieves. Use the title and initial_state as ground truth.
- Mentioning a git subcommand is optional; prefer a goal-shaped ask a user would type.
- Do NOT write a query that fits a bare single-command sibling of only the primary verb.
- Include ONE short cue grounded in steps / flags / initial_state (secondary verb idea, flag meaning, or situation) so THIS multi-step recipe is distinguishable.
{{/is_composition}}
{{^is_composition}}
Ground / single-step rules:
- The query MUST be about what this recipe's primary command does (verb: {{primary_verb}}).
- Mention the git subcommand idea in plain language (e.g. status, rebase, stash) so a searcher would match it.
- Prefer a short human phrase; do not dump the raw argv alone.
- Distinguishing cue (when this recipe is richer than a bare primary): if there are distinctive flags or a non-minimal initial_state, include ONE short cue grounded in the recipe. For a simple vanilla recipe, a primary-only ask is fine.
{{/is_composition}}

Shared rules:
- Do NOT invent unrelated workflows, flags, or other commands absent from the recipe / initial_state.
- NEVER use a generic "find the commit that introduced a specific string" query unless the recipe is actually git log/grep pickaxe.
- Prefer a short human phrase; do not dump the raw argv alone.
Output JSON { "query_text" }.

## user
Title: {{{title}}}
Primary command: {{{primary}}}
Primary verb: {{primary_verb}}
Mutation kind: {{mutation_kind}}
Initial state:
{{{initial_state}}}
Full recipe steps:
{{{listing}}}
