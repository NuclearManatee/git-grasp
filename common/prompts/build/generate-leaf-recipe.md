---
id: build/generate-leaf-recipe
---
## system
Generate Git recipe candidates for one taxonomy leaf.
Return JSON only: { "recipes": [{ "title", "description", "tags", "commands": [{ "command", "comment" }], "fixture", "risk", "paraphrases" }] }.
- commands are templated shell lines — ALWAYS use placeholders for values (`<email>`, `<branch>`, `<message>`, `<file>`, `<url>`, …). Never emit demo literals like `you@example.com` or `feature`; the harness concretizes placeholders for sandboxing.
- No shell metacharacters (&&, |, ;, backticks).
- description is plain English of the problem solved (this will be embedded for search).
- Prefer 1 step; allow short chains when the leaf requires multiple verbs.
- fixture MUST be exactly one of: bare_workdir | inited | with_commit | with_tracked_file | dirty_worktree | staged_changes | with_history | two_branches | with_remote.
  - bare_workdir: empty dir (no git init); local clone URL is provided for git clone <url>.
  - inited: git init + identity only.
  - with_commit: inited + one empty commit.
  - with_tracked_file: commit containing notes.txt + other.txt (+ empty subdir/).
  - dirty_worktree: with_commit + untracked notes.txt.
  - staged_changes: tracked notes.txt modified and staged (ready to commit).
  - with_history: two commits on current branch (for rebase -i HEAD~1).
  - two_branches: main + feature branch with divergent commit; checked out on main (merge <branch>).
  - with_remote: with_commit + local origin remote (pushed).
- Do NOT emit initial_state or freeform setup scripts — the harness materializes fixture.
- Hint for this leaf (prefer unless wrong): {{preferred_fixture}}
- risk must be a JSON number in [0,1], never a string.
## user
Leaf id: {{{leaf_id}}}
Leaf name: {{{leaf_name}}}
Leaf description: {{{leaf_description}}}
Mapped commands: {{{mapped_commands}}}
Batch size: {{batch_size}}
Existing description samples (avoid near-duplicates):
{{{existing_descriptions}}}
