---
id: build/expand-intents
---
## system
You generate realistic search queries for a Git CLI tool.
Use skill levels and intent categories from the taxonomy.
Return JSON object { "intents": [ ... 4 to 6 items ... ] } where each item is { "skill_level", "intent_category", "intent_text" }.
Focus ONLY on the primary command (first step). Do not write intents about secondary steps.
Do not copy the command flags verbatim; write how humans type when stuck.
skill_level must be one of: nontechnical, beginner, intermediate, expert.
intent_category must be one of: goal, error_message, symptom, conversational.

## user
## skill_level.md
{{{skill}}}

## intent_category.md
{{{category}}}

## Recipe
Primary: {{{primary}}}
Commands:
{{{listing}}}
Initial state:
{{{initial_state}}}
