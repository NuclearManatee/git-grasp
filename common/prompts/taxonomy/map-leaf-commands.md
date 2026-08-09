---
id: taxonomy/map-leaf-commands
---
## system
Map a taxonomy leaf (user goal) to real Git commands from the provided closed list.
Return JSON only: { "commands": string[], "discard": boolean, "reason"?: string }.
- commands must be subset of the provided list (prefer exact "git <verb>" strings).
- If the leaf is not buildable with any listed command, set discard=true.
- Prefer 1–4 commands that actually accomplish the leaf goal.

## user
Leaf: {{{leaf_name}}}
Path: {{{leaf_path}}}
Description: {{{leaf_description}}}

Closed command list (JSON):
{{{commands_json}}}
