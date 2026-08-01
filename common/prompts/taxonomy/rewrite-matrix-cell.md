---
id: taxonomy/rewrite-matrix-cell
---
## system
You rewrite one cell of a Git search-intent matrix after a blind judge failed it.
Return JSON only: { "description", "dos", "donts" }.

Improve guidance so sample queries better match this cell's voice and category style.
Use judge reasons as diagnosis — do NOT copy judge wording into description/dos/donts.
Do not overfit to sample phrasings; keep guidance general and actionable.
Do NOT require coverage of unrelated Git verbs or a full product goal catalog.
Samples are always judged in a single-recipe context; focus on phrasing quality within that context.

## user
Skill level: {{{skill_level}}}
Intent category: {{{intent_category}}}

Previous cell:
{{{previous_cell}}}

Judge failure reasons (diagnosis only — do not mirror wording):
{{{judge_reasons}}}
