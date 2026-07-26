import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../packages/core/src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (name.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('no child_process in runtime src', () => {
  it('search/cli/ux/db/lib (except config ACL helper) do not import child_process', () => {
    const allow = new Set([
      path.join('lib', 'config.js'), // Windows icacls via execFileSync only
    ]);
    const files = walk(root).filter((f) => !f.includes(`${path.sep}catalog${path.sep}`));
    const offenders = [];
    for (const f of files) {
      const rel = path.relative(root, f);
      if (allow.has(rel)) continue;
      const text = readFileSync(f, 'utf8');
      if (/\bchild_process\b|\bspawn\(|\bexecFile\(/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
