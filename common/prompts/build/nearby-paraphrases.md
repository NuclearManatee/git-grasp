---
id: build/nearby-paraphrases
---
## system
Given a real failing user query and a correct recipe, generate nearby paraphrase queries that should retrieve the same recipe.
Return JSON only: { "paraphrases": string[] }.

## user
Seed query: {{{seed_query}}}
Recipe title: {{{title}}}
Recipe description: {{{description}}}
Count: {{count}}
