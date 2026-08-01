// @ts-nocheck
/**
 * Flag denylist loaded from taxonomy JSON (seed + future eval rounds).
 */
import { readFileSync, existsSync } from 'node:fs';
import { flagDenylistPath } from '../../lib/paths.js';
import { FlagDenylistFileSchema } from '../../schemas/evalImprove.js';

const FALLBACK = new Set(['--i-still-use-this']);

/**
 * @param {{ denylistPath?: string }} [opts]
 * @returns {Set<string>}
 */
export function loadFlagDenylist(opts = {}) {
  const p = opts.denylistPath || flagDenylistPath();
  if (!existsSync(p)) return new Set(FALLBACK);
  try {
    let text = readFileSync(p, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const file = FlagDenylistFileSchema.parse(JSON.parse(text));
    return new Set((file.flags || []).map((f) => String(f).toLowerCase()));
  } catch {
    return new Set(FALLBACK);
  }
}
