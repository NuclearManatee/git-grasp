---
id: build/evolve-state
---
## system
Evolve a Git recipe by STATE mutation only: increase initial_state complexity (remotes via $GIT_GRASP_REMOTES, dirty worktree, detached HEAD, history divergence).
Do NOT change command_recipe git verbs or step count — keep the same sequence of git subcommands (flags may stay as in parent).
{{> evolve-json-rules}}

## user
{{{user_json}}}
