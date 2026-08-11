// @ts-nocheck
import * as readline from 'node:readline';
import { PRIVACY_URL } from './defaults.js';
import { style, withEmoji } from '../../ux/cliStyle.js';

/**
 * Interactive soft invite. Returns enable | disable | dismiss | skip.
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, questionFn?: (q: string) => Promise<string> }} [opts]
 */
export async function promptTelemetryInvite(opts = {}) {
  const output = opts.output || process.stderr;
  const lines = [
    withEmoji(
      'info',
      'Optional analytics help improve search for everyone (cookieless; off by default).',
    ),
    `  ${style.muted('Privacy:')} ${style.link(PRIVACY_URL)}`,
    style.muted('  Later: git-grasp telemetry on|off|status'),
    style.label('Enable telemetry? [y/N/d=don\'t ask again] '),
  ];

  let answer = '';
  if (typeof opts.questionFn === 'function') {
    answer = await opts.questionFn(lines[lines.length - 1]);
  } else {
    for (const line of lines.slice(0, -1)) {
      output.write(`${line}\n`);
    }
    const input = opts.input || process.stdin;
    if (!input.isTTY || !output.isTTY) {
      return 'skip';
    }
    const rl = readline.createInterface({ input, output, terminal: true });
    try {
      answer = await new Promise((resolve) => {
        rl.question(lines[lines.length - 1], (a) => resolve(a || ''));
      });
    } finally {
      rl.close();
    }
  }

  const a = String(answer).trim().toLowerCase();
  if (a === 'y' || a === 'yes') return 'enable';
  if (a === 'd' || a === 'dont' || a === "don't" || a === 'never') return 'dismiss';
  if (a === 'n' || a === 'no' || a === '') return 'disable';
  return 'disable';
}
