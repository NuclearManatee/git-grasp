import { mergeCommands } from './step1Commands.js';

/**
 * Ensure eval golden expected/acceptable commands exist in the catalog.
 */
export function enrichCommandsFromGolden(commands, goldenCases = []) {
  const extras = [];
  for (const g of goldenCases || []) {
    const cmds = [g.expectedCommand, ...(g.acceptableCommands || [])].filter(Boolean);
    for (const command of cmds) {
      extras.push({
        command,
        topic: inferTopic(command),
        risk_class: inferRisk(command),
        source_hint: `golden:${g.id || 'case'}`,
      });
    }
  }
  return mergeCommands(commands, extras);
}

/**
 * Everyday porcelain forms that models often emit without flags.
 */
export const ESSENTIAL_COMMANDS = Object.freeze([
  { command: 'git status', topic: 'status', risk_class: 'none' },
  { command: 'git add <file>', topic: 'stage', risk_class: 'low' },
  { command: 'git add -p', topic: 'stage', risk_class: 'low' },
  { command: 'git commit -m "<message>"', topic: 'commit', risk_class: 'low' },
  { command: 'git commit --amend --no-edit', topic: 'commit', risk_class: 'high' },
  { command: 'git clone <url>', topic: 'create', risk_class: 'low' },
  { command: 'git switch -c <name>', topic: 'branch', risk_class: 'low' },
  { command: 'git switch -', topic: 'branch', risk_class: 'low' },
  { command: 'git branch -d <name>', topic: 'branch', risk_class: 'high' },
  { command: 'git log --oneline', topic: 'history', risk_class: 'none' },
  { command: 'git diff --staged', topic: 'diff', risk_class: 'none' },
  { command: 'git reset --soft HEAD~1', topic: 'undo', risk_class: 'high' },
  { command: 'git reset --hard HEAD~1', topic: 'undo', risk_class: 'destructive' },
  { command: 'git restore --staged <file>', topic: 'undo', risk_class: 'low' },
  { command: 'git stash', topic: 'stash', risk_class: 'low' },
  { command: 'git stash pop', topic: 'stash', risk_class: 'high' },
  { command: 'git stash -u', topic: 'stash', risk_class: 'low' },
  { command: 'git rebase --abort', topic: 'rebase', risk_class: 'high' },
  { command: 'git merge --abort', topic: 'merge', risk_class: 'high' },
  { command: 'git push -u origin HEAD', topic: 'remote', risk_class: 'high' },
  { command: 'git push --force-with-lease', topic: 'remote', risk_class: 'destructive' },
  { command: 'git pull --rebase', topic: 'remote', risk_class: 'high' },
  { command: 'git fetch --all --prune', topic: 'remote', risk_class: 'low' },
  { command: 'git remote -v', topic: 'remote', risk_class: 'none' },
  { command: 'git tag -a <name> -m "<message>"', topic: 'tag', risk_class: 'low' },
  { command: 'git revert <commit>', topic: 'undo', risk_class: 'high' },
  { command: 'git rm --cached <file>', topic: 'stage', risk_class: 'high' },
  { command: 'git grep "<pattern>"', topic: 'search', risk_class: 'none' },
  { command: 'git config --global user.email "<email>"', topic: 'config', risk_class: 'low' },
  { command: 'git worktree add <path> <branch>', topic: 'worktree', risk_class: 'low' },
  { command: 'git submodule update --init --recursive', topic: 'submodule', risk_class: 'low' },
].map((c) => ({ ...c, source_hint: 'essential' })));

export function enrichCommandsFromEssentials(commands, extras = ESSENTIAL_COMMANDS) {
  return mergeCommands(commands, extras);
}

function inferTopic(command) {
  const c = String(command);
  if (/\breset\b|\brevert\b|\brestore\b/.test(c)) return 'undo';
  if (/\bstash\b/.test(c)) return 'stash';
  if (/\bswitch\b|\bbranch\b|\bcheckout\b/.test(c)) return 'branch';
  if (/\bcommit\b/.test(c)) return 'commit';
  if (/\bpush\b|\bpull\b|\bfetch\b|\bremote\b/.test(c)) return 'remote';
  if (/\brebase\b/.test(c)) return 'rebase';
  if (/\bmerge\b/.test(c)) return 'merge';
  if (/\bclone\b|\binit\b/.test(c)) return 'create';
  if (/\blog\b|\bblame\b/.test(c)) return 'history';
  if (/\bdiff\b/.test(c)) return 'diff';
  return 'advanced';
}

function inferRisk(command) {
  const c = String(command);
  if (/--hard|--force(?!-with-lease)|force-with-lease|reset --hard/.test(c)) return 'destructive';
  if (/--soft|amend|rebase|merge --abort|stash pop|push -u|rm --cached/.test(c)) return 'high';
  if (/commit|add|switch -c|tag|clone|stash\b/.test(c)) return 'low';
  return 'none';
}

/**
 * Commands present in catalog but missing from intents rows.
 */
export function commandsMissingIntents(commands, intentRows) {
  const have = new Set((intentRows || []).map((r) => r.command));
  return (commands || []).filter((c) => !have.has(c.command));
}

/**
 * Inject golden queries as intent rows so eval retrieval is grounded.
 */
export function injectGoldenIntentRows(intentRows, goldenCases = [], commandMeta = new Map()) {
  const out = [...(intentRows || [])];
  const seen = new Set(out.map((r) => `${r.command}::${r.intent_description}`));
  for (const g of goldenCases || []) {
    const command = g.expectedCommand;
    if (!command || !g.query) continue;
    const level = Array.isArray(g.expectedSkillBand)
      ? Number(g.expectedSkillBand[0]) || 3
      : 3;
    const key = `${command}::${g.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = commandMeta.get(command) || {};
    out.push({
      id: `golden-${g.id || 'case'}:${level}`,
      command,
      skill_level: level,
      intent_description: String(g.query).trim(),
      explanation: meta.explanation || `${command} (golden eval grounding)`,
      risks: meta.risks || '',
      examples: meta.examples || command,
      risk_class: meta.risk_class || inferRisk(command),
      topic: meta.topic || inferTopic(command),
    });
  }
  return out;
}
