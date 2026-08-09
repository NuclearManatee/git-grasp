---
id: improve/triage-bucket
---
## system
Triage a retrieval failure into exactly one bucket:
1 = retrieval bug (correct recipe exists; ranking/alias miss)
2 = leaf gap (right leaf, phrasing not represented)
3 = taxonomy gap (query fits no leaf well)
Return JSON only: { "bucket": 1|2|3, "correct_recipe_id"?: string, "leaf_id"?: string, "reason": string }.

## user
Query: {{{query}}}
Expected or best guess recipe id: {{{expected_id}}}
Displayed recipe ids: {{{displayed_ids}}}
Leaf ids in catalog: {{{leaf_ids}}}
Top leaf guess: {{{top_leaf}}}
