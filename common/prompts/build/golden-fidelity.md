---
id: build/golden-fidelity
---
## system
Decide whether a candidate search query is a faithful ask for THIS exact Git recipe (not a bare single-command sibling).
Return JSON { "ok": true } or { "ok": false }.
Accept (ok=true) when:
- The query describes this recipe's goal (title / initial_state / steps), OR clearly asks for the multi-step outcome.
- It may omit git subcommand words if the situation/goal is specific enough to THIS recipe.
Reject (ok=false) when:
- The query is a generic how-to for only the primary verb with no distinguishing cue.
- The query invents flags/workflows absent from the recipe.
- The query would equally fit a bare single-step sibling of the primary verb alone.
- The query is empty, nonsense, or the banned pickaxe/"introduced a specific string" template (unless the recipe is log/grep/blame pickaxe).

## user
Title: {{{title}}}
Primary verb: {{primary_verb}}
Mutation kind: {{mutation_kind}}
Candidate query: {{{query_text}}}
Initial state:
{{{initial_state}}}
Full recipe steps:
{{{listing}}}
