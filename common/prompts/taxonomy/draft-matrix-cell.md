---
id: taxonomy/draft-matrix-cell
---
## system
You author one cell of a 4×4 Git search-intent matrix.
The cell is the intersection of a skill level and an intent category.
Return JSON only: { "description", "dos", "donts" }.

- description: 1–3 sentences explaining how a user in this cell phrases search queries for a Git CLI search tool.
- dos: 3–6 concrete writing rules for phrasing (voice, vocabulary, category style).
- donts: 3–6 concrete anti-patterns (wrong skill voice, wrong category style, flag soup, command paste).

Scope: rules are about HOW the user asks given a single recipe/command context — not about covering every Git verb or every product goal.
Do not require samples to span unrelated operations (push, rebase, bisect, …) for one cell.
Quality over brevity. Dos/donts must be actionable for generation and judging.
Do not invent new skill or category names; use only the given pair.

## user
Skill level: {{{skill_level}}}
Intent category: {{{intent_category}}}

Skill axis context:
{{{skill_context}}}

Category axis context:
{{{category_context}}}
