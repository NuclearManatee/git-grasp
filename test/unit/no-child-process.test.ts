// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../common/src');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(p));
    else if (name.name.endsWith('.ts') || name.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('no child_process in runtime src', () => {
  it('search/cli/ux/db/lib (except allowlisted) do not import child_process', () => {
    const allow = new Set([
      path.join('lib', 'config.ts'), // Windows icacls via execFileSync only
      path.join('lib', 'config.js'),
      path.join('build', 'gitExec.ts'),
      path.join('build', 'gitExec.js'),
      path.join('build', 'sandbox.ts'),
      path.join('build', 'sandbox.js'),
      path.join('build', 'taxonomyScrape.ts'),
      path.join('build', 'taxonomyScrape.js'),
      path.join('build', 'gitShortHelp.ts'),
      path.join('build', 'gitShortHelp.js'),
    ]);
    const files = walk(root).filter((f) => !f.includes(`${path.sep}catalog${path.sep}`));
    const offenders = [];
    for (const f of files) {
      const rel = path.relative(root, f);
      if (allow.has(rel)) continue;
      // Pipeline/build maintainer tools may spawn git — only gate product runtime surfaces.
      if (rel.startsWith(`build${path.sep}`)) continue;
      const text = readFileSync(f, 'utf8');
      if (/\bfrom ['"]node:child_process['"]|\brequire\(['"]child_process['"]\)/.test(text)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
