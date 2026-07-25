import { TOPIC_CHECKLIST, critiqueCoverage } from './critique.js';
import { normalizeExample, validateExample, validateCommand } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { sanitizeField } from '../lib/ansi.js';

export function buildExtractorSystem(glossary) {
  return `You are the git-help catalog EXTRACTOR.
Read git documentation and list git subcommands with pasteable examples.
Return JSON only:
{
  "commands": [
    {
      "command": "git symbolic-ref",
      "examples": [
        { "example": "git symbolic-ref HEAD", "topic": "branch", "risk_class": "none", "source_hint": "note" }
      ]
    }
  ]
}
Rules:
- "command" is the subcommand family key (e.g. "git status", "git reset") — may be bare git <sub>.
- Each command MUST include 3–5 concrete "examples" a developer can copy-paste (no <placeholders>).
- Prefer 5 examples for everyday porcelain (status, commit, branch, push, pull, stash, log, diff, add).
- Examples MUST start with "git" and MUST NOT contain shell operators (&& || | ; \` $() \${).
- Use ONLY tokens from this glossary when you need names/files/urls/messages:
${JSON.stringify(glossary || DEFAULT_GLOSSARY)}
- topic must be one of: ${TOPIC_CHECKLIST.join(', ')}
- risk_class one of: none, low, high, destructive
- Prefer porcelain / everyday usage from the docs.`;
}

export function buildAreYouSureSystem(glossary) {
  return `You are auditing a git command catalog for completeness ("Are you sure?" reinforcement).
Return JSON only:
{
  "sure": false,
  "missing_topics": ["undo"],
  "additional_commands": [
    {
      "command": "git reset",
      "examples": [
        { "example": "git reset --soft HEAD~1", "topic": "undo", "risk_class": "high", "source_hint": "gap" }
      ]
    }
  ],
  "rationale": "short"
}
Rules:
- If sure=true, additional_commands MUST be [].
- Each additional command needs 3–5 pasteable examples (glossary tokens only, no placeholders).
- Glossary: ${JSON.stringify(glossary || DEFAULT_GLOSSARY)}
- Never invent shell pipelines or non-git tools.`;
}

/**
 * Flatten command+examples entries into example rows; E4 dedupe on example.
 */
export function flattenCommandExamples(entries = [], glossary = DEFAULT_GLOSSARY) {
  const out = [];
  for (const entry of entries || []) {
    const command = sanitizeField(entry.command || '', 512);
    if (!command && !entry.example) continue;
    let examples = Array.isArray(entry.examples) ? entry.examples : [];
    // Already-flat example row (has .example, no .examples array)
    if (examples.length === 0 && entry.example) {
      examples = [{
        example: entry.example,
        topic: entry.topic,
        risk_class: entry.risk_class,
        source_hint: entry.source_hint,
        intent_family: entry.intent_family,
        simplicity_rank: entry.simplicity_rank,
      }];
    } else if (examples.length === 0 && entry.command) {
      // Legacy: treat entry.command as the only example
      examples = [{
        example: entry.command,
        topic: entry.topic,
        risk_class: entry.risk_class,
        source_hint: entry.source_hint,
      }];
    }
    for (const ex of examples) {
      const raw = ex.example || ex.command || '';
      const example = normalizeExample(materializePlaceholders(raw, glossary));
      if (!example) continue;
      out.push({
        command: deriveCommandKey(command || example, example),
        example,
        topic: sanitizeField(ex.topic || entry.topic || 'advanced', 64),
        risk_class: ex.risk_class || entry.risk_class || 'none',
        source_hint: sanitizeField(ex.source_hint || entry.source_hint || '', 200),
        intent_family: ex.intent_family || entry.intent_family || '',
        simplicity_rank: ex.simplicity_rank ?? entry.simplicity_rank,
      });
    }
  }
  return out;
}

/**
 * Prefer bare "git <sub>" as command key when example is longer.
 */
export function deriveCommandKey(command, example) {
  const c = normalizeExample(command);
  const e = normalizeExample(example);
  const cParts = c.split(/\s+/);
  const eParts = e.split(/\s+/);
  if (cParts.length >= 2 && cParts.length <= 3) return c;
  if (eParts.length >= 2) return eParts.slice(0, 2).join(' ');
  return c || e;
}

/**
 * Merge and dedupe by E4 normalized example.
 */
export function mergeCommands(existing = [], incoming = [], glossary = DEFAULT_GLOSSARY) {
  const flat = [
    ...flattenCommandExamples(existing, glossary),
    ...flattenCommandExamples(incoming, glossary),
  ];
  const map = new Map();
  for (const row of flat) {
    if (!row.example) continue;
    const key = normalizeExample(row.example);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...row, example: key });
      continue;
    }
    // Keep richer metadata / longer source_hint
    map.set(key, {
      command: prev.command || row.command,
      example: key,
      topic: prev.topic !== 'advanced' ? prev.topic : row.topic,
      risk_class: prev.risk_class !== 'none' ? prev.risk_class : row.risk_class,
      source_hint: (prev.source_hint?.length || 0) >= (row.source_hint?.length || 0)
        ? prev.source_hint
        : row.source_hint,
      intent_family: prev.intent_family || row.intent_family || '',
      simplicity_rank: prev.simplicity_rank ?? row.simplicity_rank,
    });
  }
  return [...map.values()];
}

/**
 * Group flat examples back into { command, examples: [...] } for artifacts.
 */
export function groupByCommand(flatExamples = []) {
  const map = new Map();
  for (const row of flatExamples) {
    const cmd = row.command || deriveCommandKey(row.example, row.example);
    if (!map.has(cmd)) map.set(cmd, []);
    map.get(cmd).push({
      example: row.example,
      topic: row.topic,
      risk_class: row.risk_class,
      source_hint: row.source_hint,
      intent_family: row.intent_family,
      simplicity_rank: row.simplicity_rank,
    });
  }
  return [...map.entries()]
    .map(([command, examples]) => ({ command, examples }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

/**
 * Ensure each command group has minExamples (pad by duplicating variants if needed — caller should LLM-fill).
 */
export function commandsNeedingMoreExamples(grouped, minExamples = 3) {
  return grouped.filter((g) => (g.examples?.length || 0) < minExamples);
}

/**
 * Step 1: extract commands+examples from doc pages, then Are-You-Sure loops.
 */
export async function extractCommandsWithAreYouSure({
  pages,
  llmJson,
  groqJson,
  schedule,
  glossary = DEFAULT_GLOSSARY,
  maxRounds = 5,
  minCommands = 200,
  onRound = () => {},
}) {
  const jsonFn = llmJson || groqJson;
  if (!jsonFn) throw new Error('llmJson (or groqJson) required');
  let commands = [];
  const extractorSystem = buildExtractorSystem(glossary);
  const aysSystem = buildAreYouSureSystem(glossary);

  for (const page of pages) {
    const out = await schedule(() => jsonFn({
      messages: [
        { role: 'system', content: extractorSystem },
        {
          role: 'user',
          content: JSON.stringify({
            url: page.url,
            documentation_text: page.text,
            glossary,
          }),
        },
      ],
    }));
    commands = mergeCommands(commands, out.commands || [], glossary);
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
        { role: 'system', content: aysSystem },
        {
          role: 'user',
          content: JSON.stringify({
            are_you_sure: true,
            question: 'Are you sure this git command catalog is complete for everyday developers?',
            min_examples: minCommands,
            current_count: commands.length,
            topic_checklist: TOPIC_CHECKLIST,
            coverage_missing_topics: coverage.missing,
            sample_examples: commands.slice(0, 80).map((c) => c.example),
            all_topics_present: [...new Set(commands.map((c) => c.topic))],
            glossary,
          }),
        },
      ],
    }));

    const added = mergeCommands([], audit.additional_commands || [], glossary);
    commands = mergeCommands(commands, added, glossary);
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

    sure = Boolean(audit.sure) && commands.length >= minCommands && after.missing.length === 0;
    if (sure) break;
    if (audit.sure && commands.length < minCommands) continue;
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

export { validateExample, validateCommand, normalizeExample };
