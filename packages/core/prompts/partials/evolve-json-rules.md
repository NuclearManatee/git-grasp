Return JSON object:
{
  "initial_state": "shell script string",
  "command_recipe": { "commands": [ { "command": "git ...", "comment": "..." } ] },
  "risk": 0.0
}
command_recipe MUST be an object (never a JSON string). Each command is a SINGLE git invocation with NO shell metacharacters (no &&, ||, |, ;, `, $).
The harness already ran git init and set user.name/user.email.
