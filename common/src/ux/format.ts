// @ts-nocheck
import { sanitizeField } from '../lib/ansi.js';
import { skillName } from '../lib/skills.js';
import { normalizeExample } from '../lib/normalizeText.js';
import { clipboardTextFromRecipe } from '../catalog/recipeIdentity.js';
import { style, cautionLine, errorLine, warnLine } from './cliStyle.js';

export const SEARCH_FALLBACK_MESSAGE =
  'No confident match. Try rephrasing, or run git help.';

const ALERT_COPY = {
  yellow: 'Several plausible matches — verify before running.',
  orange: 'Uncertain match — review alternatives carefully before running.',
  red: SEARCH_FALLBACK_MESSAGE,
};

/**
 * Stable JSON payload for `git-grasp --json`.
 * @param {object} result
 */
export function formatSearchResultJson(result) {
  const shown = result.displayResults ?? result.results ?? [];
  const alert = result.alert || (result.status === 'empty' ? 'red' : 'none');
  return {
    status: result.status ?? (shown.length ? 'ok' : 'empty'),
    query: result.query ?? null,
    confidence: typeof result.confidence === 'number' ? result.confidence : null,
    alert,
    blend: result.blend ?? null,
    results: shown.map((r) => ({
      id: r.id ?? r.command_id ?? null,
      title: r.example || r.title || r.command || '',
      description: r.intent_description || r.intent_text || '',
      commands: Array.isArray(r.commands)
        ? r.commands.map((c) => ({
          command: c.command || c.run || '',
          comment: c.comment || null,
        }))
        : [],
      example: r.example ?? r.command ?? null,
      score: typeof r.score === 'number' ? r.score : null,
      score_cosine: r.score_cosine ?? null,
      score_bm25: r.score_bm25 ?? null,
      skill_level: r.skill_level ?? null,
      risk: r.risk ?? null,
    })),
  };
}

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
    lines.push(errorLine(ALERT_COPY.red));
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
    lines.push(warnLine(ALERT_COPY.yellow));
  } else if (alert === 'orange') {
    lines.push(cautionLine(ALERT_COPY.orange));
  }

  const topRisk = Number(shown[0]?.risk ?? 0);
  if (topRisk > 0.7) {
    lines.push(cautionLine(`High-risk recipe (${topRisk.toFixed(2)}) — review before running.`));
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
  return parts.length ? style.muted(parts.join('  ')) : '';
}

function formatPrimaryBlock(r, prefix = '', { verbose = false } = {}) {
  const title = sanitizeField(r.example || r.title || r.command || '');
  const intent = sanitizeField(r.intent_description || r.intent_text, 200);
  const skill = skillName(r.skill_level);
  const lines = [];

  lines.push(prefix + style.title(title));
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
  if (!comment) return `  ${style.command(run)}`;
  return `  ${style.command(run)}${style.muted(comment)}`;
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
  const rule = style.muted(`  ${'─'.repeat(width)}`);
  const out = [rule];
  out.push(`  ${style.command(sanitizeField(commandLine))}`);
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
