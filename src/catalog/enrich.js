import { mergeCommands } from './step1Commands.js';
import { coerceSkillBandValue } from '../lib/skills.js';
import { normalizeExample } from '../lib/validator.js';
import { materializePlaceholders, DEFAULT_GLOSSARY } from './step0Glossary.js';
import { makeRowId } from '../lib/validator.js';

/**
 * Ensure eval golden expected/acceptable examples exist in the catalog.
 */
export function enrichCommandsFromGolden(commands, goldenCases = [], glossary = DEFAULT_GLOSSARY) {
  const extras = [];
  for (const g of goldenCases || []) {
    const examples = [
      g.expectedExample,
      g.expectedCommand,
      g.expectedSimplestExample,
      ...(g.acceptableExamples || []),
      ...(g.acceptableCommands || []),
    ].filter(Boolean);
    for (const raw of examples) {
      const example = normalizeExample(materializePlaceholders(raw, glossary));
      extras.push({
        command: g.expectedCommand || example,
        examples: [{
          example,
          topic: inferTopic(example),
          risk_class: inferRisk(example),
          source_hint: `golden:${g.id || 'case'}`,
        }],
      });
    }
  }
  return mergeCommands(commands, extras, glossary);
}

/**
 * Everyday porcelain forms — concrete examples (no placeholders).
 */
export const ESSENTIAL_COMMANDS = Object.freeze([
  { command: 'git status', examples: [
    { example: 'git status', topic: 'status', risk_class: 'none' },
    { example: 'git status -sb', topic: 'status', risk_class: 'none' },
    { example: 'git status --ignored', topic: 'status', risk_class: 'none' },
  ] },
  { command: 'git add', examples: [
    { example: 'git add app.js', topic: 'stage', risk_class: 'low' },
    { example: 'git add -p', topic: 'stage', risk_class: 'low' },
    { example: 'git add .', topic: 'stage', risk_class: 'low' },
  ] },
  { command: 'git commit', examples: [
    { example: 'git commit -m "Fix typo"', topic: 'commit', risk_class: 'low' },
    { example: 'git commit --amend --no-edit', topic: 'commit', risk_class: 'high' },
    { example: 'git commit -am "Fix typo"', topic: 'commit', risk_class: 'low' },
  ] },
  { command: 'git clone', examples: [
    { example: 'git clone https://github.com/example/repo.git', topic: 'create', risk_class: 'low' },
    { example: 'git clone --depth 1 https://github.com/example/repo.git', topic: 'create', risk_class: 'low' },
    { example: 'git clone --branch main https://github.com/example/repo.git', topic: 'create', risk_class: 'low' },
  ] },
  { command: 'git switch', examples: [
    { example: 'git switch -c feature/login', topic: 'branch', risk_class: 'low' },
    { example: 'git switch -', topic: 'branch', risk_class: 'low' },
    { example: 'git switch main', topic: 'branch', risk_class: 'low' },
  ] },
  { command: 'git branch', examples: [
    { example: 'git branch', topic: 'branch', risk_class: 'none' },
    { example: 'git branch --show-current', topic: 'branch', risk_class: 'none' },
    { example: 'git branch -d feature/login', topic: 'branch', risk_class: 'high' },
  ] },
  { command: 'git log', examples: [
    { example: 'git log --oneline', topic: 'history', risk_class: 'none' },
    { example: 'git log --graph --oneline --all', topic: 'history', risk_class: 'none' },
    { example: 'git log -p', topic: 'history', risk_class: 'none' },
  ] },
  { command: 'git diff', examples: [
    { example: 'git diff', topic: 'diff', risk_class: 'none' },
    { example: 'git diff --staged', topic: 'diff', risk_class: 'none' },
    { example: 'git diff HEAD', topic: 'diff', risk_class: 'none' },
  ] },
  { command: 'git reset', examples: [
    { example: 'git reset --soft HEAD~1', topic: 'undo', risk_class: 'high' },
    { example: 'git reset --hard HEAD~1', topic: 'undo', risk_class: 'destructive' },
    { example: 'git reset HEAD app.js', topic: 'undo', risk_class: 'high' },
  ] },
  { command: 'git restore', examples: [
    { example: 'git restore --staged app.js', topic: 'undo', risk_class: 'low' },
    { example: 'git restore app.js', topic: 'undo', risk_class: 'high' },
    { example: 'git restore --source=HEAD~1 app.js', topic: 'undo', risk_class: 'high' },
  ] },
  { command: 'git stash', examples: [
    { example: 'git stash', topic: 'stash', risk_class: 'low' },
    { example: 'git stash pop', topic: 'stash', risk_class: 'high' },
    { example: 'git stash -u', topic: 'stash', risk_class: 'low' },
  ] },
  { command: 'git rebase', examples: [
    { example: 'git rebase --abort', topic: 'rebase', risk_class: 'high' },
    { example: 'git rebase main', topic: 'rebase', risk_class: 'high' },
    { example: 'git rebase -i HEAD~3', topic: 'rebase', risk_class: 'destructive' },
  ] },
  { command: 'git merge', examples: [
    { example: 'git merge --abort', topic: 'merge', risk_class: 'high' },
    { example: 'git merge main', topic: 'merge', risk_class: 'high' },
    { example: 'git merge --no-ff feature/login', topic: 'merge', risk_class: 'high' },
  ] },
  { command: 'git push', examples: [
    { example: 'git push -u origin HEAD', topic: 'remote', risk_class: 'high' },
    { example: 'git push --force-with-lease', topic: 'remote', risk_class: 'destructive' },
    { example: 'git push', topic: 'remote', risk_class: 'high' },
  ] },
  { command: 'git pull', examples: [
    { example: 'git pull', topic: 'remote', risk_class: 'high' },
    { example: 'git pull --rebase', topic: 'remote', risk_class: 'high' },
    { example: 'git pull origin main', topic: 'remote', risk_class: 'high' },
  ] },
  { command: 'git fetch', examples: [
    { example: 'git fetch --all --prune', topic: 'remote', risk_class: 'low' },
    { example: 'git fetch', topic: 'remote', risk_class: 'low' },
    { example: 'git fetch origin', topic: 'remote', risk_class: 'low' },
  ] },
  { command: 'git remote', examples: [
    { example: 'git remote -v', topic: 'remote', risk_class: 'none' },
    { example: 'git remote add origin https://github.com/example/repo.git', topic: 'remote', risk_class: 'low' },
    { example: 'git remote remove origin', topic: 'remote', risk_class: 'high' },
  ] },
  { command: 'git tag', examples: [
    { example: 'git tag -a v1.0.0 -m "Fix typo"', topic: 'tag', risk_class: 'low' },
    { example: 'git tag v1.0.0', topic: 'tag', risk_class: 'low' },
    { example: 'git tag -l', topic: 'tag', risk_class: 'none' },
  ] },
  { command: 'git revert', examples: [
    { example: 'git revert HEAD', topic: 'undo', risk_class: 'high' },
    { example: 'git revert abc1234', topic: 'undo', risk_class: 'high' },
    { example: 'git revert --no-edit HEAD', topic: 'undo', risk_class: 'high' },
  ] },
  { command: 'git rm', examples: [
    { example: 'git rm --cached app.js', topic: 'stage', risk_class: 'high' },
    { example: 'git rm app.js', topic: 'stage', risk_class: 'high' },
    { example: 'git rm -r src', topic: 'stage', risk_class: 'destructive' },
  ] },
  { command: 'git grep', examples: [
    { example: 'git grep "TODO"', topic: 'search', risk_class: 'none' },
    { example: 'git grep -n "FIXME"', topic: 'search', risk_class: 'none' },
    { example: 'git grep -i "todo"', topic: 'search', risk_class: 'none' },
  ] },
  { command: 'git config', examples: [
    { example: 'git config --global user.email "dev@example.com"', topic: 'config', risk_class: 'low' },
    { example: 'git config user.name "alice"', topic: 'config', risk_class: 'low' },
    { example: 'git config --list', topic: 'config', risk_class: 'none' },
  ] },
  { command: 'git worktree', examples: [
    { example: 'git worktree add ../hotfix feature/login', topic: 'worktree', risk_class: 'low' },
    { example: 'git worktree list', topic: 'worktree', risk_class: 'none' },
    { example: 'git worktree remove ../hotfix', topic: 'worktree', risk_class: 'high' },
  ] },
  { command: 'git submodule', examples: [
    { example: 'git submodule update --init --recursive', topic: 'submodule', risk_class: 'low' },
    { example: 'git submodule status', topic: 'submodule', risk_class: 'none' },
    { example: 'git submodule add https://github.com/example/repo.git', topic: 'submodule', risk_class: 'low' },
  ] },
].map((c) => ({
  ...c,
  examples: c.examples.map((e) => ({ ...e, source_hint: 'essential' })),
})));

export function enrichCommandsFromEssentials(commands, extras = ESSENTIAL_COMMANDS, glossary = DEFAULT_GLOSSARY) {
  return mergeCommands(commands, extras, glossary);
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
 * Examples present in catalog but missing from intents rows.
 */
export function commandsMissingIntents(commands, intentRows) {
  const have = new Set((intentRows || []).map((r) => normalizeExample(r.example || r.command)));
  return (commands || []).filter((c) => !have.has(normalizeExample(c.example || c.command)));
}

/**
 * Inject golden queries as intent rows so eval retrieval is grounded.
 */
export function injectGoldenIntentRows(intentRows, goldenCases = [], commandMeta = new Map(), glossary = DEFAULT_GLOSSARY) {
  const out = [...(intentRows || [])];
  const seen = new Set(out.map((r) => `${normalizeExample(r.example || r.command)}::${r.intent_description}`));
  for (const g of goldenCases || []) {
    const example = normalizeExample(materializePlaceholders(
      g.expectedExample || g.expectedSimplestExample || g.expectedCommand || '',
      glossary,
    ));
    const command = normalizeExample(materializePlaceholders(g.expectedCommand || example, glossary));
    if (!example || !g.query) continue;
    let level = 2;
    if (Array.isArray(g.expectedSkillBand) && g.expectedSkillBand.length) {
      try {
        level = coerceSkillBandValue(g.expectedSkillBand[0]);
      } catch {
        level = 2;
      }
    }
    const key = `${example}::${g.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const meta = commandMeta.get(example) || commandMeta.get(command) || {};
    out.push({
      id: `golden-${g.id || 'case'}:${level}`,
      command,
      example,
      intent_family: meta.intent_family || '',
      simplicity_rank: meta.simplicity_rank ?? (g.preferSimplest ? 1 : 1),
      skill_level: level,
      intent_description: String(g.query).trim(),
      explanation: meta.explanation || `${example} (golden eval grounding)`,
      risks: meta.risks || '',
      examples: example,
      risk_class: meta.risk_class || inferRisk(example),
      topic: meta.topic || inferTopic(example),
    });
  }
  return out;
}

export { inferTopic, inferRisk, makeRowId };
