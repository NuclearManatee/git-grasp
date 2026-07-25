# Judge criteria (immutable to improve-loop)

Pass when the actual command is semantically equivalent for the user query to the expected command (or any acceptableCommands entry).

Fail when:
- A destructive variant is returned for a soft/safe undo request (e.g. `--hard` when soft was required)
- Wrong verb entirely (push vs pull, etc.)
- Empty / null actual command

Score 1–5: 5 exact or clearly equivalent; 3 partial; 1 wrong.
