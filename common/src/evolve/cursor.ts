// @ts-nocheck
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { EvolveCursorSchema } from './schemas.js';
import { evolveCursorPath, evolveLocalDir } from './paths.js';

/**
 * @param {string} [root]
 * @returns {import('./schemas.js').EvolveCursor}
 */
export function readEvolveCursor(root) {
  const file = evolveCursorPath(root);
  if (!existsSync(file)) {
    return { last_pulled_at: null, last_event_id: null };
  }
  try {
    return EvolveCursorSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return { last_pulled_at: null, last_event_id: null };
  }
}

/**
 * @param {import('./schemas.js').EvolveCursor} cursor
 * @param {string} [root]
 */
export function writeEvolveCursor(cursor, root) {
  mkdirSync(evolveLocalDir(root), { recursive: true });
  const payload = {
    ...cursor,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(evolveCursorPath(root), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}
