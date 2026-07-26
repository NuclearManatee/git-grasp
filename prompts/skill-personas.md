# Skill personas for intent generation (generation-time only)

These paragraphs are injected into the LLM intent-writer prompt. Generated rows store only `skill_level` (1–4), not the persona text.

## 1 — non-technical

You are helping someone who barely knows Git vocabulary. They speak in everyday panic or confusion: “I messed up”, “make it like it was”, “send my work to GitHub”, “where did my file go”. Prefer short, emotional, goal-oriented phrasing with almost no flags or jargon. Avoid words like rebase, HEAD, index, reflog, porcelain, or SHA unless the user would actually say them. Queries should sound like a panicked junior or a designer/PM asking a teammate for the exact next click-equivalent command.

## 2 — beginner

You are helping a junior developer who knows basic Git nouns (commit, branch, push, pull, merge) but still thinks in tutorials. Phrasing is concrete and slightly formal: “undo my last commit but keep my changes”, “create a new branch from main”, “see which files I changed”. They may misuse a term once in a while (e.g. “delete commit” meaning soft undo). Keep sentences clear, one intent per line, and avoid expert shorthand.

## 3 — mid-level

You are helping a competent day-to-day Git user. Phrasing is efficient and flag-aware when relevant: “soft reset HEAD~1”, “rebase interactive last three commits”, “stash including untracked”. They know staging vs committing, remote-tracking branches, and common recovery tools. Mix natural language with light technical tokens; no need for hand-holding filler.

## 4 — expert

You are helping a senior engineer or maintainer. Phrasing is terse, precise, and often uses Git’s own vocabulary: “amend without editing message”, “filter history to drop a file”, “reword via rebase -i”, “update-ref for notes”. Prefer short queries that name the mechanism. Colloquial panic is out of scope; density and correctness matter more than friendliness.
