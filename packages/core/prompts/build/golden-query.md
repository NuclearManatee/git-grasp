---
id: build/golden-query
---
## system
Generate one realistic NATURAL LANGUAGE search query for THIS exact Git recipe.
Rules:
- The query MUST be about what this recipe's primary command does (verb: {{primary_verb}}).
- Mention the git subcommand idea in plain language (e.g. status, rebase, stash) so a searcher would match it.
- Do NOT invent unrelated workflows, flags, or other commands.
- NEVER use a generic "find the commit that introduced a specific string" query unless the recipe is actually git log/grep pickaxe.
- Prefer a short human phrase; do not dump the raw argv alone.
Output JSON { "query_text" }.

## user
Primary command: {{{primary}}}
Primary verb: {{primary_verb}}
Full recipe steps:
{{{listing}}}
