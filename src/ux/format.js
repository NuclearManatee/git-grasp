import chalk from 'chalk';
import { sanitizeField } from '../lib/ansi.js';

export function formatSearchResult(result, { verbose = false } = {}) {
  const lines = [];
  if (result.status === 'ambiguous') {
    result.results.forEach((r, i) => {
      lines.push(
        chalk.bold(`Option ${i + 1}: `) + chalk.cyan(sanitizeField(r.command))
        + chalk.dim(`  (skill ${r.skill_level}) — ${sanitizeField(r.intent_description, 120)}`),
      );
    });
    lines.push(chalk.yellow('hint: rephrase with more detail (flags, soft vs hard, local vs remote)'));
  } else {
    const r = result.results[0];
    if (!r) {
      lines.push(chalk.red('No match'));
      return lines.join('\n');
    }
    lines.push(chalk.cyan(sanitizeField(r.command)));
    lines.push(chalk.dim(sanitizeField(r.intent_description, 200)));
    if (
      (r.risk_class === 'high' || r.risk_class === 'destructive')
      && r.skill_level <= 2
    ) {
      lines.push(chalk.red(`[RISK] ${r.risk_class}`));
    }
    if (verbose) {
      lines.push('');
      lines.push(chalk.bold('Explanation'));
      lines.push(sanitizeField(r.explanation));
      lines.push(chalk.bold('Risks'));
      lines.push(sanitizeField(r.risks));
      lines.push(chalk.bold('Examples'));
      lines.push(sanitizeField(r.examples));
      lines.push(chalk.dim(`Matched skill level: ${r.skill_level}`));
    }
  }
  if (result.lowConfidence) {
    lines.push(chalk.yellow('warning: low confidence — verify before running'));
  }
  // Chalk wraps trusted labels; sanitizeField already cleaned dynamic text.
  return lines.join('\n');
}

export function primaryCommand(result) {
  return result.results?.[0]?.command ?? null;
}
