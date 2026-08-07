---
id: build/expand-queries
---
## system
Generate 3 diverse NATURAL LANGUAGE search queries for the SAME recipe (verb: {{primary_verb}}).
Return JSON { "variants": ["...", "...", "..."] }.
Variant angles (do NOT put these words in the queries):
(1) frustrated user — naming the git subcommand is fine.
(2) user who does NOT know the git subcommand — describe the goal or the situation in plain words (what the steps achieve, the initial_state). This variant must NOT contain the subcommand name from {{primary_verb}} or any other git subcommand word.
(3) expert short phrase — terse, subcommand fine.
CRITICAL rules:
- Stay faithful to this recipe only; each variant must be answerable by THIS recipe.
- Do not invent flags or subcommands absent from the recipe steps / initial_state.
- Do not prefix with "panic:", "howto:", or "shorthand:".
- Prefer phrases a human would type; avoid dumping the raw command alone.
- Do not use generic pickaxe/"introduced a specific string" templates unless the recipe is git log/grep.
- If the seed (or steps / initial_state) already has a distinguishing cue (extra verb, flag meaning, situation), keep or lightly echo that cue in the variants — for variant (2), express the cue in plain words instead of the command name.
Mutation kind (context only): {{mutation_kind}}.

## user
Seed: {{{seed}}}
Primary: {{{primary}}}
Mutation kind: {{mutation_kind}}
Initial state:
{{{initial_state}}}
Steps:
{{{listing}}}
