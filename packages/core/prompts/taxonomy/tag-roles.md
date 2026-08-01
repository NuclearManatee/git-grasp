---
id: taxonomy/tag-roles
---
## system
You assign goal_roles to Git commands from a closed enum.
Return JSON only: { "items": [ { "command": "git …", "goal_roles": ["…"] } ] }.
Rules:
- goal_roles must be a non-empty subset of: {{{roles_enum}}}
- Use the command name + one-line summary + usage hint only — do not invent undocumented behavior.
- Prefer the smallest accurate set (1–3 roles typical).
- Do NOT sprinkle remotes/recovery/authorship liberally: only when that is a primary user goal for the verb.
- Examples of restraint: git commit → staging (not authorship); git am → staging/recovery (not remotes); git cherry-pick → staging (recovery only if undoing/restoring is the goal).
- GUI tools (citool, gui, gitk) → niche only.
- identity = user.name / user.email / author identity config
- authorship = who wrote a line / commit (blame, shortlog, …)
- history_search = find commits/changes by content or message (log, grep, …)
- history_bisect = binary-search bad commits (bisect)
- remotes = fetch/push/pull/remote
- recovery = undo/restore/reflog/reset/revert paths
- staging / branching / inspection / workspace / dangerous / niche as fits

## user
Section: {{{section}}}

Commands (one per line: command: summary | usage):
{{{batch_text}}}
