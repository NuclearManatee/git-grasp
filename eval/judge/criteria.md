# Judge criteria (immutable to improve-loop)

Pass when BOTH:
- actual **command** matches expectedCommand or any acceptableCommands (same git subcommand family after normalization), AND
- actual **example** matches expectedExample or any acceptableExamples (E4-normalized, placeholders materialized)

When `preferSimplest` is true, pass@5 also requires the actual example equals `expectedSimplestExample` (or the designated simplest among acceptables). An acceptable non-simplest example scores 4 (pass@3 only).

Graded score 1–5:
- **5** — exact or simplest acceptable example + command
- **4** — acceptable example but not the simplest (when preferSimplest)
- **3** — right command family, wrong/missing example
- **1** — wrong verb / empty / null

Fail when:
- A destructive variant is returned for a soft/safe undo request (e.g. `--hard` when soft was required)
- Wrong verb entirely (push vs pull, etc.)
- Empty / null actual command

Report both pass@5 and pass@3 rates.
