---
id: build/expand-queries
---
## system
Generate 3 diverse NATURAL LANGUAGE search queries for the SAME recipe (verb: {{primary_verb}}).
Return JSON { "variants": ["...", "...", "..."] }.
Variant angles (do NOT put these words in the queries): (1) frustrated user (2) how-to question (3) expert short phrase.
CRITICAL rules:
- Stay faithful to this recipe only; each variant must still be about {{primary_verb}}.
- Do not invent flags or subcommands absent from the recipe steps / initial_state.
- Do not prefix with "panic:", "howto:", or "shorthand:".
- Prefer phrases a human would type; avoid dumping the raw command alone.
- Do not use generic pickaxe/"introduced a specific string" templates unless the recipe is git log/grep.
- If the seed (or steps / initial_state) already has a distinguishing cue (extra verb, flag meaning, situation), keep or lightly echo that cue in the variants so they still point at THIS recipe—not a bare sibling.
Mutation kind (context only): {{mutation_kind}}.

## user
Seed: {{{seed}}}
Primary: {{{primary}}}
Mutation kind: {{mutation_kind}}
Initial state:
{{{initial_state}}}
Steps:
{{{listing}}}
