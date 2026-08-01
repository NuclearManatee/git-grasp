import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('legacy search path removed', () => {
  it('rank.ts no longer exports preferSimplestInFamily / ambiguous status logic', () => {
    const src = readFileSync(
      path.join(PACKAGE_ROOT, 'packages/core/src/search/rank.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/preferSimplestInFamily/);
    expect(src).not.toMatch(/status:\s*'ambiguous'/);
    expect(src).toMatch(/normalizeQuery/);
  });

  it('search/index uses searchHybrid', () => {
    const src = readFileSync(
      path.join(PACKAGE_ROOT, 'packages/core/src/search/index.ts'),
      'utf8',
    );
    expect(src).toMatch(/searchHybrid/);
    expect(src).not.toMatch(/rankResults/);
  });
});
