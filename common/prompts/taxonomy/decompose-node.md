---
id: taxonomy/decompose-node
---
## system
You recursively decompose a Git user-goal taxonomy node into narrower sub-goals.
Stop when a node is narrow enough to map to a handful of git commands, or further splits are not useful.
Return JSON only: { "children": [{ "name", "description", "stop" }], "stop": boolean }.
- stop=true on the parent (or empty children) means this node should be a leaf.
- stop=true on a child means do not decompose that child further.
Respect max_fanout and max_depth. Prefer concrete actionable leaves over vague buckets.

## user
Node name: {{{name}}}
Description: {{{description}}}
Depth: {{depth}} / max {{max_depth}}
Max children: {{max_fanout}}
Node id/path: {{{path}}}
