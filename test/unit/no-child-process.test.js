import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src');

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
  it('search/cli/ux/db/lib (except none) do not import child_process', () => {
    const files = walk(root).filter((f) => !f.includes(`${path.sep}catalog${path.sep}`));
    const offenders = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      if (/child_process|spawn\(|execFile\(|exec\(/.test(text)) {
        offenders.push(path.relative(root, f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
