// @ts-nocheck
/**
 * Load / save lexicon traps from taxonomy JSON.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { lexiconTrapsPath } from '../../lib/paths.js';
import { LexiconTrapsFileSchema } from '../../schemas/evalImprove.js';

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile trap needles into one case-insensitive wordish regex.
 * @param {string[]} needles
 */
export function compileTrapNeedles(needles) {
  const parts = (needles || [])
    .map((n) => escapeRegex(String(n).trim()))
    .filter(Boolean);
  if (!parts.length) return /$a/; // never matches
  return new RegExp(`(?:${parts.join('|')})`, 'i');
}

/**
 * @param {{ trapsPath?: string, traps?: object }} [opts]
 * @returns {{ role: string, needles: RegExp, preferVerb: string, raw: object }[]}
 */
export function loadLexiconTraps(opts = {}) {
  if (opts.traps) {
    const file = LexiconTrapsFileSchema.parse(opts.traps);
    return file.traps.map((t) => ({
      role: t.role,
      needles: compileTrapNeedles(t.needles),
      preferVerb: t.prefer_verb,
      raw: t,
    }));
  }
  const p = opts.trapsPath || lexiconTrapsPath();
  if (!existsSync(p)) return [];
  let text = readFileSync(p, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const file = LexiconTrapsFileSchema.parse(JSON.parse(text));
  return file.traps.map((t) => ({
    role: t.role,
    needles: compileTrapNeedles(t.needles),
    preferVerb: t.prefer_verb,
    raw: t,
  }));
}

export function readLexiconTrapsFile(opts = {}) {
  const p = opts.trapsPath || lexiconTrapsPath();
  if (!existsSync(p)) return { version: 1, traps: [] };
  let text = readFileSync(p, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return LexiconTrapsFileSchema.parse(JSON.parse(text));
}

export function writeLexiconTrapsFile(file, opts = {}) {
  const p = opts.trapsPath || lexiconTrapsPath();
  const parsed = LexiconTrapsFileSchema.parse(file);
  writeFileSync(p, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

/**
 * Merge trap proposals into file (by role key).
 */
export function mergeLexiconTrapProposals(file, proposals) {
  const traps = [...(file.traps || [])];
  const byRole = new Map(traps.map((t, i) => [t.role, i]));
  for (const p of proposals || []) {
    if (p.kind !== 'lexicon_trap') continue;
    const row = {
      role: p.role,
      needles: p.needles,
      prefer_verb: p.prefer_verb,
      source: 'eval_round',
      evidence_command_ids: p.evidence_command_ids,
    };
    if (byRole.has(p.role)) {
      traps[byRole.get(p.role)] = row;
    } else {
      byRole.set(p.role, traps.length);
      traps.push(row);
    }
  }
  return LexiconTrapsFileSchema.parse({ version: file.version || 1, traps });
}
