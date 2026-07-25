import { TOPIC_CHECKLIST, critiqueCoverage } from './critique.js';

const EXTRACTOR_SYSTEM = `You are the git-help catalog EXTRACTOR.
Read git documentation text and list concrete git command examples a developer would type.
Return JSON only:
{
  "commands": [
    { "command": "git status", "topic": "status", "risk_class": "none", "source_hint": "short note" }
  ]
}
Rules:
- command MUST start with "git" and MUST NOT contain shell operators (&& || | ; \` $() \${).
- Use placeholders like <file>, <branch>, <url>, <message> where needed.
- Prefer porcelain / everyday commands from the docs.
- topic must be one of: ${TOPIC_CHECKLIST.join(', ')}
- risk_class one of: none, low, high, destructive
- Aim for many distinct useful examples, not just bare subcommand names.`;

const ARE_YOU_SURE_SYSTEM = `You are auditing a git command catalog for completeness ("Are you sure?" reinforcement).
Given the current command list and a topic checklist, decide if the catalog is complete enough.
Return JSON only:
{
  "sure": false,
  "missing_topics": ["undo"],
  "additional_commands": [
    { "command": "git reset --soft HEAD~1", "topic": "undo", "risk_class": "high", "source_hint": "why missing" }
  ],
  "rationale": "short"
}
Rules:
- If sure=true, additional_commands MUST be [].
- If sure=false, propose additional_commands that fill gaps (same command field rules as extractor).
- Never invent shell pipelines or non-git tools.`;

/**
 * Merge and dedupe command entries by command string.
 */
export function mergeCommands(existing = [], incoming = []) {
  const map = new Map();
  for (const c of [...(existing || []), ...(incoming || [])]) {
    if (!c?.command) continue;
    const key = String(c.command).trim();
    if (!map.has(key)) {
      map.set(key, {
        command: key,
        topic: c.topic || 'advanced',
        risk_class: c.risk_class || 'none',
        source_hint: c.source_hint || '',
      });
    }
  }
  return [...map.values()];
}

/**
 * Step 1: extract commands from doc pages, then Are-You-Sure loops until sure or max rounds.
 */
export async function extractCommandsWithAreYouSure({
  pages,
  llmJson,
  groqJson,
  schedule,
  maxRounds = 5,
  minCommands = 200,
  onRound = () => {},
}) {
  const jsonFn = llmJson || groqJson;
  if (!jsonFn) throw new Error('llmJson (or groqJson) required');
  let commands = [];

  // Staged extraction: one (or few) pages per call to save tokens
  for (const page of pages) {
    const out = await schedule(() => jsonFn({
      messages: [
        { role: 'system', content: EXTRACTOR_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            url: page.url,
            documentation_text: page.text,
          }),
        },
      ],
    }));
    commands = mergeCommands(commands, out.commands || []);
    onRound({ phase: 'extract', url: page.url, count: commands.length });
  }

  let round = 0;
  let sure = false;
  const rounds = [];
  while (round < maxRounds) {
    round += 1;
    const coverage = critiqueCoverage(commands);
    const audit = await schedule(() => jsonFn({
      messages: [
        { role: 'system', content: ARE_YOU_SURE_SYSTEM },
        {
          role: 'user',
          content: JSON.stringify({
            are_you_sure: true,
            question: 'Are you sure this git command catalog is complete for everyday developers?',
            min_commands: minCommands,
            current_count: commands.length,
            topic_checklist: TOPIC_CHECKLIST,
            coverage_missing_topics: coverage.missing,
            sample_commands: commands.slice(0, 80).map((c) => c.command),
            all_topics_present: [...new Set(commands.map((c) => c.topic))],
          }),
        },
      ],
    }));

    const added = mergeCommands([], audit.additional_commands || []);
    commands = mergeCommands(commands, added);
    sure = Boolean(audit.sure) && commands.length >= minCommands && coverage.missing.length === 0;
    // Recompute after merge
    const after = critiqueCoverage(commands);
    const roundInfo = {
      round,
      sure: Boolean(audit.sure),
      rationale: audit.rationale || '',
      added: added.length,
      count: commands.length,
      missing_topics: after.missing,
    };
    rounds.push(roundInfo);
    onRound({ phase: 'are_you_sure', ...roundInfo });

    if (audit.sure && commands.length >= minCommands && after.missing.length === 0) {
      sure = true;
      break;
    }
    // If model is "sure" but under min count, force continue by treating as not sure
    if (audit.sure && commands.length < minCommands) {
      sure = false;
      continue;
    }
    if (added.length === 0 && after.missing.length === 0 && commands.length >= minCommands) {
      sure = true;
      break;
    }
  }

  return {
    commands,
    sure,
    rounds,
    coverage: critiqueCoverage(commands),
  };
}
