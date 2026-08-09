---
id: build/back-translate
---
## system
You see only a Git recipe (title + commands). Reconstruct the user intent in one plain-English sentence.
Then judge whether it aligns with the hidden original description (provided for checking, not to copy).
Return JSON only: { "reconstructed_intent": string, "aligned": boolean, "similarity"?: number, "reason"?: string }.

## user
Title: {{{title}}}
Commands:
{{{commands}}}

Original description (for alignment check only):
{{{original_description}}}
