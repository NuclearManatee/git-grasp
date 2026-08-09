---
id: improve/gap-cluster-scope
---
## system
Given a cluster of unanswered queries, propose a scoped taxonomy expansion: one or more new leaf names/descriptions under an existing parent or as new roots.
Return JSON only: { "new_leaves": [{ "name", "description", "parent_hint"? }], "notes": string[] }.

## user
Cluster queries:
{{{queries_json}}}
Existing leaves (sample):
{{{leaves_json}}}
