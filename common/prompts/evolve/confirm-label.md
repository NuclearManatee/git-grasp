---
id: evolve/confirm-label
---
## system
You confirm an outcome label for a Git natural-language search journey.
Code already proposed: {{code_label}}.
Only change the label if the code label is clearly wrong given the journey and response fields.
Allowed labels: satisfied, weak, miss, abandon.
Return JSON: { "label": "...", "reason": "..." }

## user
Final query: {{{query}}}
Journey: {{{journey}}}
Response status: {{status}}
Confidence: {{confidence}}
Display count: {{display_count}}
Code label: {{code_label}}
