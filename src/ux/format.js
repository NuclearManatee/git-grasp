import chalk from 'chalk';
import { sanitizeField } from '../lib/ansi.js';
import { skillName, RISK_WARN_MAX_LEVEL } from '../lib/skills.js';
import { normalizeExample } from '../lib/validator.js';

export function formatSearchResult(result, { verbose = false } = {}) {
  const lines = [];
  if (result.status === 'ambiguous') {
    result.results.forEach((r, i) => {
      lines.push(formatPrimaryBlock(r, `Option ${i + 1}: `));
    });
    lines.push(chalk.yellow('hint: rephrase with more detail (flags, soft vs hard, local vs remote)'));
  } else {
    const r = result.results[0];
    if (!r) {
      lines.push(chalk.red('No match'));
      return lines.join('\n');
    }
    lines.push(formatPrimaryBlock(r));
    if (
      (r.risk_class === 'high' || r.risk_class === 'destructive')
      && Number(r.skill_level) <= RISK_WARN_MAX_LEVEL
    ) {
      lines.push(chalk.red(`[RISK] ${r.risk_class}`));
    }
    if (verbose) {
      lines.push('');
      lines.push(chalk.bold('Explanation'));
      lines.push(sanitizeField(r.explanation));
      lines.push(chalk.bold('Risks'));
      lines.push(sanitizeField(r.risks));
      const adv = result.advanced;
      if (adv) {
        lines.push('');
        lines.push(chalk.bold('Also (advanced)'));
        lines.push(formatPrimaryBlock(adv));
      }
      lines.push(chalk.dim(`Matched skill: ${skillName(r.skill_level)}`));
    }
  }
  if (result.lowConfidence) {
    lines.push(chalk.yellow('warning: low confidence — verify before running'));
  }
  return lines.join('\n');
}

function formatPrimaryBlock(r, prefix = '') {
  const command = sanitizeField(r.command);
  const example = sanitizeField(r.example ?? r.command);
  const skill = skillName(r.skill_level);
  const intent = sanitizeField(r.intent_description, 120);
  const lines = [];
  const same = normalizeExample(command) === normalizeExample(example);
  if (same) {
    lines.push(prefix + chalk.cyan(example));
  } else {
    lines.push(prefix + chalk.bold(command));
    lines.push(chalk.cyan(example));
  }
  lines.push(chalk.dim(`(skill ${skill}) — ${intent}`));
  return lines.join('\n');
}

/** Pasteable example for clipboard. */
export function primaryCommand(result) {
  const r = result.results?.[0];
  if (!r) return null;
  return r.example ?? r.command ?? null;
}
