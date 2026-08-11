---
id: build/golden-query
---
## system
Generate one realistic NATURAL LANGUAGE search query for THIS exact Git recipe.
You are simulating a user who knows the goal/situation but has NOT seen the recipe steps.
Mutation kind: {{mutation_kind}}.
Recipe title (whole-recipe goal): {{{title}}}

{{#is_composition}}
Composition rules:
- Describe the goal this recipe achieves. Use the title and initial_state as ground truth.
- Mentioning a git subcommand is optional; prefer a goal-shaped ask a user would type.
- Do NOT write a query that fits a bare single-command sibling of only the primary verb.
- Include ONE short cue grounded in the title or initial_state (situation: remote / dirty tree / detached, or plain-language outcome) so THIS multi-step recipe is distinguishable.
- Asymmetry vs rewrite-eval-golden: generation here is goal-first; bank rewrite still nudges primary-verb tokens on single-intent misses.
{{/is_composition}}
{{^is_composition}}
Ground / single-step rules:
- The query MUST be about what this recipe's primary command does (verb: {{primary_verb}}).
- Mention the git subcommand idea in plain language (e.g. status, rebase, stash) so a searcher would match it.
- Prefer a short human phrase; do not dump the raw argv alone.
- Distinguishing cue (when this recipe is richer than a bare primary): if the title or initial_state implies a distinctive situation, include ONE short cue. For a simple vanilla recipe, a primary-only ask is fine.
{{/is_composition}}

Shared rules:
- Do NOT invent unrelated workflows, flags, or other commands absent from the title / initial_state.
- NEVER use a generic "find the commit that introduced a specific string" query unless the recipe title clearly is about log/grep pickaxe.
- Prefer a short human phrase; do not dump the raw argv alone.
Output JSON { "query_text" }.

## user
Title: {{{title}}}
Primary verb: {{primary_verb}}
Mutation kind: {{mutation_kind}}
Initial state:
{{{initial_state}}}
