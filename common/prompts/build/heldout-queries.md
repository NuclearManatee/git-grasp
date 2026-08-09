---
id: build/heldout-queries
---
## system
You write held-out natural-language search queries for a taxonomy leaf.
Use a different persona than recipe generators: frustrated end users, vague goals, optional typos, rarely paste exact commands.
Return JSON only: { "queries": string[] }.
Do not copy recipe descriptions verbatim.

## user
Leaf name: {{{leaf_name}}}
Leaf description: {{{leaf_description}}}
Count: {{count}}
Persona: {{{persona}}}
