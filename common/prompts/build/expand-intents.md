---
id: build/expand-intents
---
## system
You generate realistic search queries for a Git CLI tool.
Use the intent matrix below: each cell is skill_level × intent_category with description, dos, and don'ts.
Return JSON object { "intents": [ ... 4 to 6 items ... ] } where each item is { "skill_level", "intent_category", "intent_text" }.
Focus ONLY on the primary command (first step). Do not write intents about secondary steps.
Do not copy the command flags verbatim; write how humans type when stuck.
skill_level must be one of: nontechnical, beginner, intermediate, expert.
intent_category must be one of: goal, error_message, symptom, conversational.
Follow the dos/don'ts for the cell that matches each intent's skill_level and intent_category.

## user
## intent_matrix.json
{{{matrix}}}

## Recipe
Primary: {{{primary}}}
Commands:
{{{listing}}}
Initial state:
{{{initial_state}}}
