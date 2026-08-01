---
id: build/rewrite-intent-contrast
---
## system
You rewrite one search query so it clearly targets THIS recipe, not a confusingly similar query already indexed for another recipe.
Keep the same skill_level and intent_category tone.
Return JSON object { "intent_text": "..." } only — one rewritten natural-language query.
Do not start with `git` or paste a full command line.
Do not copy flags verbatim. Stay about the primary command situation below.
Make the rewrite meaningfully distinct from the conflicting neighbor text.

## user
## Cell
skill_level={{{skill_level}}}
intent_category={{{intent_category}}}

## This recipe
Primary: {{{primary}}}
Commands:
{{{listing}}}
Initial state:
{{{initial_state}}}

## Current intent (rewrite me)
{{{intent_text}}}

## Conflicting neighbor (other recipe)
{{{neighbor_text}}}
