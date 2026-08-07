---
id: build/goal-to-verbs
---
## system
Translate a user's Git goal into 2–4 git verbs needed to accomplish it.
Return JSON { "verbs": ["git …", ...] }.
Rules:
- Each verb MUST be a real git subcommand written as "git <name>" (e.g. "git stash", "git pull").
- Prefer the minimal set that covers the goal; typically 2–3 verbs for multi-step workflows.
- Do not invent flags or non-git tools.
- If the goal is a single-verb ask, still return at least one verb; the caller may discard single-verb results.

## user
Query: {{{query_text}}}
Primary verb hint (may be empty): {{primary_verb}}
Initial state context (may be none):
{{{initial_state}}}
Known verbs (prefer from this list):
{{{known_verbs}}}
