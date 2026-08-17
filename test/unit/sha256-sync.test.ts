import { describe, it, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../../common/src/lib/sha256Sync.js';

describe('sha256Sync', () => {
  it('matches node:crypto for short ASCII strings', () => {
    const samples = ['', 'git reset --soft HEAD~1', 'a'.repeat(200)];
    for (const s of samples) {
      const node = createHash('sha256').update(s).digest('hex');
      expect(sha256Hex(s)).toBe(node);
    }
  });
});
