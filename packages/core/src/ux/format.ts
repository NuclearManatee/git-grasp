// @ts-nocheck
import chalk from 'chalk';
import { sanitizeField } from '../lib/ansi.js';
import { skillName } from '../lib/skills.js';
import { normalizeExample } from '../lib/validator.js';
import { clipboardTextFromRecipe } from '../catalog/recipeIdentity.js';

export const SEARCH_FALLBACK_MESSAGE =
  'No command found with sufficient confidence. Try rephrasing or use git help.';

const ALERT_COPY = {
  yellow: 'Multiple plausible matches — verify before running.',
  orange: 'Uncertain match — review alternatives carefully before running.',
  red: SEARCH_FALLBACK_MESSAGE,
};

/**
 * Format search result for CLI (hybrid displayResults 0..3).
 * @param {object} result
 * @param {{ verbose?: boolean }} [opts]
 */
export function formatSearchResult(result, { verbose = false } = {}) {
  const lines = [];
  const shown = result.displayResults ?? result.results ?? [];
  const alert = result.alert || (result.status === 'empty' ? 'red' : 'none');

  if (!shown.length || result.status === 'empty' || alert === 'red') {
    lines.push(chalk.red(ALERT_COPY.red));
    const confLine = formatConfidenceLine(result, { verbose });
    if (confLine) lines.push(confLine);
    return lines.join('\n');
  }

  shown.forEach((r, i) => {
    const prefix = shown.length > 1 ? `${i + 1}. ` : '';
    if (i > 0) lines.push('');
    lines.push(formatPrimaryBlock(r, prefix, { verbose }));
  });

  if (alert === 'yellow') {
    lines.push(chalk.yellow(ALERT_COPY.yellow));
  } else if (alert === 'orange') {
    lines.push(chalk.hex('#FF8C00')(ALERT_COPY.orange));
  }

  const topRisk = Number(shown[0]?.risk ?? 0);
  if (topRisk > 0.7) {
    lines.push(chalk.red(`warning: high risk recipe (${topRisk.toFixed(2)})`));
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
  const top = (result.displayResults ?? result.results)?.[0];
  const score = top?.score;
  const c = typeof result.confidence === 'number' ? result.confidence : null;

  if (!verbose) return '';

  const parts = [];
  if (c != null) parts.push(`confidence: ${c.toFixed(3)}`);
  if (result.alert && result.alert !== 'none') parts.push(`alert: ${result.alert}`);
  if (typeof score === 'number') parts.push(`score: ${score.toFixed(3)}`);
  if (top?.score_cosine != null) parts.push(`cos: ${Number(top.score_cosine).toFixed(3)}`);
  if (top?.score_bm25 != null) parts.push(`bm25: ${Number(top.score_bm25).toFixed(3)}`);
  if (result.blend) {
    parts.push(`α=${result.blend.alpha}/β=${result.blend.beta}`);
  }
  return parts.length ? chalk.dim(parts.join('  ')) : '';
}

function formatPrimaryBlock(r, prefix = '', { verbose = false } = {}) {
  const title = sanitizeField(r.example || r.title || r.command || '');
  const intent = sanitizeField(r.intent_description || r.intent_text, 200);
  const skill = skillName(r.skill_level);
  const lines = [];

  lines.push(prefix + chalk.bold(title));
  lines.push(...formatSnippetBlock(r));
  lines.push(...formatUsageFrame(r));

  if (verbose) {
    lines.push(`${intent} (${skill}-level)`);
  } else if (intent) {
    lines.push(intent);
  }
  return lines.join('\n');
}

export function colorizeSnippetLine(line) {
  const raw = sanitizeField(line);
  const m = raw.match(/^(.*?)(\s+#\s.*)?$/);
  const run = (m?.[1] ?? raw).trimEnd();
  const comment = m?.[2] ?? '';
  if (!comment) return `  ${chalk.cyan(run)}`;
  return `  ${chalk.cyan(run)}${chalk.dim(comment)}`;
}

export function formatSnippetBlock(r) {
  if (Array.isArray(r.commands) && r.commands.length) {
    return r.commands.map((c) => {
      const run = sanitizeField(c.command || c.run || '');
      const comment = c.comment ? `  # ${sanitizeField(c.comment)}` : '';
      return colorizeSnippetLine(`${run}${comment}`);
    });
  }
  const snippet = r.snippet || r.example || r.command || '';
  return String(snippet).split(/\n/).filter((l) => l.length).map(colorizeSnippetLine);
}

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
  if (/^git(\s|$)/.test(parts[0])) {
    return { commandLine: parts[0], blurb: '' };
  }
  return { commandLine: example, blurb: parts[0] || '' };
}

export function primaryCommand(result) {
  const r = (result.displayResults ?? result.results)?.[0];
  if (!r) return null;
  if (Array.isArray(r.commands) && r.commands.length) {
    return clipboardTextFromRecipe(r);
  }
  return r.example ?? r.command ?? null;
}

export { normalizeExample };
