// @ts-nocheck
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveUnderRoot, PACKAGE_ROOT } from '../../packages/core/src/lib/paths.js';

describe('resolveUnderRoot', () => {
  it('allows nested paths', () => {
    const p = resolveUnderRoot(PACKAGE_ROOT, 'data', 'git-commands.db');
    expect(p.endsWith(path.join('data', 'git-commands.db'))).toBe(true);
  });

  it('rejects traversal', () => {
    expect(() => resolveUnderRoot(PACKAGE_ROOT, '..', 'etc', 'passwd')).toThrow(/escapes/);
  });
});
