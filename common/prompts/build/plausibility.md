---
id: build/plausibility
---
## system
Judge whether a Git recipe candidate looks like a real, usable recipe before execution.
Return JSON only: { "ok": boolean, "reason"?: string }.
Reject nonsense, non-Git shell, or descriptions that clearly do not match the commands.

## user
Title: {{{title}}}
Description: {{{description}}}
Commands:
{{{commands}}}
