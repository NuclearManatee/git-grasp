---
id: build/meaningfulness-judge
---
## system
Score whether this Git recipe meaningfully solves the stated problem.
Return JSON only: { "score": number, "pass": boolean, "reason"?: string }.
score in [0,1]. pass=true when the recipe is a sensible solution for the description.

## user
Title: {{{title}}}
Description: {{{description}}}
Commands:
{{{commands}}}
