import chalk from 'chalk';
import { sanitizeField } from '../lib/ansi.js';
import { skillName } from '../lib/skills.js';
import { normalizeExample } from '../lib/validator.js';

/**
 * Format search result for CLI.
 * @param {object} result
 * @param {{ verbose?: boolean }} [opts]
 */
export function formatSearchResult(result, { verbose = false } = {}) {
  const lines = [];
  if (result.status === 'ambiguous') {
    result.results.forEach((r, i) => {
      lines.push(formatPrimaryBlock(r, `Option ${i + 1}: `, { verbose }));
    });
    lines.push(chalk.yellow('hint: rephrase with more detail (flags, soft vs hard, local vs remote)'));
  } else {
    const r = result.results[0];
    if (!r) {
      lines.push(chalk.red('No match'));
      return lines.join('\n');
    }
    lines.push(formatPrimaryBlock(r, '', { verbose }));
    if (verbose) {
      lines.push('');
      lines.push(chalk.bold('Explanation'));
      lines.push(sanitizeField(r.explanation));
      const adv = result.advanced;
      if (adv) {
        lines.push('');
        lines.push(chalk.bold('Also (advanced)'));
        lines.push(formatPrimaryBlock(adv, '', { verbose: false }));
      }
    }
  }

  const confLine = formatConfidenceLine(result, { verbose });
  if (confLine) lines.push(confLine);

  return lines.join('\n');
}

/**
 * @param {object} result
 * @param {{ verbose?: boolean }} [opts]
 */
export function formatConfidenceLine(result, { verbose = false } = {}) {
  const top = result.results?.[0];
  const score = top?.score;
  const confidence = result.confidence
    || (result.lowConfidence ? 'low' : 'ok');
  const ambiguous = result.status === 'ambiguous' || result.ambiguous;

  let line = '';
  if (confidence === 'very_low') {
    line = chalk.red('very low confidence — rephrase or verify before running');
  } else if (confidence === 'low') {
    line = chalk.yellow('low confidence — rephrase or verify before running');
  } else if (ambiguous && confidence === 'ok') {
    line = chalk.green('looks like a solid match');
  }
  // Single clear hit with ok confidence: silent

  if (line && verbose && typeof score === 'number') {
    line += chalk.dim(`  (score: ${score.toFixed(3)})`);
  } else if (!line && verbose && typeof score === 'number') {
    line = chalk.dim(`score: ${score.toFixed(3)}`);
  }
  return line;
}

function formatPrimaryBlock(r, prefix = '', { verbose = false } = {}) {
  const command = sanitizeField(r.command);
  const intent = sanitizeField(r.intent_description, 200);
  const skill = skillName(r.skill_level);
  const lines = [];

  lines.push(prefix + chalk.bold(command));
  lines.push(...formatUsageFrame(r));

  if (verbose) {
    lines.push(`${intent} (${skill}-level command)`);
  } else {
    lines.push(intent);
  }
  return lines.join('\n');
}

/**
 * Indent + dim horizontal rules around usage command_line + blurb.
 */
export function formatUsageFrame(r) {
  const { commandLine, blurb } = parseUsage(r);
  const width = Math.max(28, Math.min(56, Math.max(commandLine.length, blurb.length) + 2));
  const rule = chalk.dim(`  ${'─'.repeat(width)}`);
  const out = [rule];
  out.push(`  ${chalk.cyan(sanitizeField(commandLine))}`);
  if (blurb) out.push(`  ${sanitizeField(blurb, 200)}`);
  out.push(rule);
  return out;
}

export function parseUsage(r) {
  const example = r.example ?? r.command ?? '';
  const raw = String(r.usage || '').trim();
  if (!raw) {
    return { commandLine: example, blurb: '' };
  }
  const parts = raw.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { commandLine: parts[0], blurb: parts.slice(1).join(' ') };
  }
  // Single line: if it looks like a git command, use as command_line only
  if (/^git(\s|$)/.test(parts[0])) {
    return { commandLine: parts[0], blurb: '' };
  }
  return { commandLine: example, blurb: parts[0] || '' };
}

/** Pasteable example for clipboard. */
export function primaryCommand(result) {
  const r = result.results?.[0];
  if (!r) return null;
  return r.example ?? r.command ?? null;
}

export { normalizeExample };
