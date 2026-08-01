---
id: build/expand-intents
---
## system
You generate realistic search queries for a Git CLI tool.
Use the intent matrix below: each cell is skill_level × intent_category with description, dos, and don'ts.
Focus on the EMPTY CELLS listed in the user message. Prefer filling those cells.
Return JSON object:
{
  "intents": [ ... up to {{{batch_size}}} items ... ],
  "skips": [ ... optional honest skips for empty cells that do not fit this recipe ... ]
}
Each intent item is { "skill_level", "intent_category", "intent_text" }.
Each skip item is { "skill_level", "intent_category", "reason" }.
You may return only skips, only intents, or both — but at least one intent or one skip.
Do not invent intents for cells that cannot realistically apply; skip them with a short reason.
Primary focus: the primary command (first step) is the topic of every intent.
Soft delta (optional): when the recipe listing or initial_state shows extra steps, distinctive flags, or a non-minimal situation, about 1–2 intents in the batch may lightly mention that cue; the rest stay primary-only. Never invent verbs, flags, or situations absent from the recipe / initial_state. Never write intents whose main topic is only a secondary step.
Do not copy the command flags verbatim; write how humans type when stuck.
skill_level must be one of: nontechnical, beginner, intermediate, expert.
intent_category must be one of: goal, error_message, symptom, conversational.
Follow the dos/don'ts for the cell that matches each intent's skill_level and intent_category.
Vary phrasing; avoid near-clones of the same idea.

## user
## intent_matrix.json
{{{matrix}}}

## Empty cells to cover
{{{empty_cells}}}

## Recipe
Primary: {{{primary}}}
Commands:
{{{listing}}}
Initial state:
{{{initial_state}}}
