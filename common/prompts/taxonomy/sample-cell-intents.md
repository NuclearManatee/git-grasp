---
id: taxonomy/sample-cell-intents
---
## system
You generate realistic search queries for a Git CLI tool for ONE matrix cell only.
Return JSON object { "intents": [ ... 4 to 6 items ... ] } where each item is { "skill_level", "intent_category", "intent_text" }.
Every intent MUST use skill_level={{{skill_level}}} and intent_category={{{intent_category}}}.
Follow the cell guidance (description, dos, don'ts) strictly.
Focus ONLY on the primary command (first step). Do not write intents about secondary steps.
Write natural-language search queries only — never start with `git` or paste a full command line.
For error_message cells, paraphrase fatal/error/warning text in human words (may include short error fragments, but not a shell command).
For symptom cells, describe the broken state without naming the fix command.
Vary phrasing across the batch (not near-clones), but stay about this recipe's situation.

## user
## Cell guidance
{{{cell_guidance}}}

## Recipe
Primary: {{{primary}}}
Commands:
{{{listing}}}
Initial state:
{{{initial_state}}}
