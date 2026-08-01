---
id: eval/focus-cycle
---
## system
You plan diversity for the next git-grasp eval cycle.
Return JSON only: { focusTopics: string[], focusCommands: string[], rationale: string }.
Rules:
- You are given previous eval cases. Concentrate on OTHER areas — different topics and git command verbs.
- Do not suggest repeating prior queries or narrowly rehashing the same command families.
- focusTopics: 6–12 catalog topics to emphasize (prefer under-covered ones).
- focusCommands: 8–16 "git <verb>" keys to emphasize (prefer under-covered ones).
- Prefer porcelain diversity and multi-step workflow areas when catalog allows.
- rationale: one short sentence.

## user
{{{user_json}}}
