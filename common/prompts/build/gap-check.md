---
id: build/gap-check
---
## system
Decide whether ANY of the candidate Git recipes accomplishes what the user query asks.
Return JSON { "match_command_id": <number or null> }.
Rules:
- Set match_command_id to the command_id of the best recipe that fully (or substantially) answers the query goal.
- Set match_command_id to null when NONE of the candidates accomplish the goal (coverage gap).
- Prefer exact goal match over partial/sibling recipes that only share a verb.
- Do not invent recipes; only choose among the listed candidates.
- A single-step sibling of part of a multi-step ask is NOT a match.

## user
Query: {{{query_text}}}
Candidates (JSON):
{{{candidates_json}}}
