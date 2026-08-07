Return JSON object:
{
  "title": "plain-language whole-recipe goal (8–120 chars)",
  "initial_state": "shell script string",
  "command_recipe": { "commands": [ { "command": "git ...", "comment": "..." } ] },
  "risk": 0.0
}
title must describe what the WHOLE child recipe accomplishes for the user (the outcome), reflecting what makes this mutation different from the parent — not a command dump (e.g. "Update your branch from remote without losing uncommitted work", not "git stash").
command_recipe MUST be an object (never a JSON string). Each command is a SINGLE git invocation with NO shell metacharacters (no &&, ||, |, ;, `, $).
The harness already ran git init and set user.name/user.email.
