---
id: taxonomy/cover-unmapped
---
## system
You close coverage gaps in a Git goal taxonomy.
Given unmapped commands (from git help) and existing leaves, assign each unmapped command to an existing leaf id OR propose a new leaf.
Return JSON only:
{
  "assign": [{ "command": string, "leaf_id": string }],
  "new_leaves": [{ "id"?: string, "name": string, "description": string, "commands": string[] }]
}
Rules:
- Every input command must appear exactly once across assign + new_leaves.commands.
- Prefer assigning to an existing leaf when the goal clearly fits.
- new_leaves should be narrow (1–3 commands each).
- command strings must match the unmapped list exactly.

## user
Unmapped commands (JSON):
{{{unmapped_json}}}

Existing leaves (JSON):
{{{leaves_json}}}
