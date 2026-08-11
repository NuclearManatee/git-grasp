// @ts-nocheck
/**
 * CLI chalk + emoji tokens — keep in sync with docs/cli-ux.md
 */
import chalk from 'chalk';

export const EMOJI = {
  ok: '✅',
  warn: '⚠️',
  error: '❌',
  info: 'ℹ️',
};

/** Safe env for Node + browser (default params must not touch bare `process`). */
export function resolveEnv(env) {
  if (env) return env;
  if (typeof process !== 'undefined' && process.env) return process.env;
  return {};
}

export function emojiEnabled(env) {
  const e = resolveEnv(env);
  if (e.GIT_GRASP_NO_EMOJI === '1' || e.GIT_GRASP_NO_EMOJI === 'true') return false;
  return e.GIT_GRASP_EMOJI === '1' || e.GIT_GRASP_EMOJI === 'true';
}

export function glyph(kind, env) {
  if (!emojiEnabled(env)) return '';
  return EMOJI[kind] || '';
}

/** Prefix a sentence with an emoji (+ space) when enabled. */
export function withEmoji(kind, text, env) {
  const g = glyph(kind, env);
  return g ? `${g} ${text}` : text;
}

export const style = {
  brand: (s) => chalk.bold(s),
  command: (s) => chalk.cyan(s),
  title: (s) => chalk.bold(s),
  ok: (s) => chalk.green(s),
  label: (s) => chalk.bold(s),
  muted: (s) => chalk.dim(s),
  link: (s) => chalk.cyan.underline(s),
  warn: (s) => chalk.yellow(s),
  caution: (s) => chalk.hex('#FF8C00')(s),
  error: (s) => chalk.red(s),
  okMark: (s) => chalk.green(s),
  failMark: (s) => chalk.red.bold(s),
};

/** “✅ Telemetry: on” / “ℹ️ Telemetry: off” */
export function statusLine(label, on, env) {
  const value = on ? style.ok('on') : style.muted('off');
  const head = `${style.label(`${label}:`)} ${value}`;
  return withEmoji(on ? 'ok' : 'info', head, env);
}

export function withLink(text, url) {
  return `${text} ${style.link(url)}`;
}

export function okLine(text, env) {
  return style.ok(withEmoji('ok', text, env));
}

export function infoLine(text, env) {
  return style.muted(withEmoji('info', text, env));
}

export function warnLine(text, env) {
  return style.warn(withEmoji('warn', text, env));
}

export function cautionLine(text, env) {
  return style.caution(withEmoji('warn', text, env));
}

export function errorLine(text, env) {
  return style.error(withEmoji('error', text, env));
}

/**
 * Doctor: `DB: OK …` → `DB: ✅ …`, FAIL/MISSING → ❌,
 * `  Fix: …` → `  ℹ️ Fix: …`
 */
export function doctorPaint(line, env) {
  const useEmoji = emojiEnabled(env);
  const fixMatch = line.match(/^(\s*)Fix:\s*(.*)$/);
  if (fixMatch) {
    return style.muted(`${fixMatch[1]}${withEmoji('info', `Fix: ${fixMatch[2]}`, env)}`);
  }
  if (line.startsWith('  ')) return style.muted(line);

  if (useEmoji) {
    return line
      .replace(/\bFAIL\b/g, EMOJI.error)
      .replace(/\bMISSING\b/g, EMOJI.error)
      .replace(/\bOK\b/g, EMOJI.ok);
  }
  if (/\bFAIL\b/.test(line) || /\bMISSING\b/.test(line)) {
    return line
      .replace(/\bFAIL\b/g, style.failMark('FAIL'))
      .replace(/\bMISSING\b/g, style.failMark('MISSING'));
  }
  if (/\bOK\b/.test(line)) {
    return line.replace(/\bOK\b/g, style.okMark('OK'));
  }
  return line;
}

export function doctorFixLine(text, env) {
  return style.muted(`  ${withEmoji('info', `Fix: ${text}`, env)}`);
}
