import { describe, expect, it } from 'vitest';
import {
  classifyForeignHit,
  dedupeBatchByCosine,
  findForeignCollision,
  findWithinNearDup,
  cosineSimilarity,
} from '../../../common/src/build/intentSimilarity.ts';

/** 2-d unit vectors for boundary tests (helpers only use min length). */
function vec(x: number, y: number) {
  const n = Math.hypot(x, y) || 1;
  return [x / n, y / n];
}

describe('intentSimilarity', () => {
  it('findWithinNearDup drops identical and near vectors at 0.90', () => {
    const a = vec(1, 0);
    const keepers = [{ intent_text: 'a', embedding: a }];
    expect(findWithinNearDup(a, keepers, 0.9).dup).toBe(true);
    const near = vec(0.95, Math.sqrt(1 - 0.95 * 0.95));
    // cos(a, near) = 0.95
    expect(cosineSimilarity(a, near)).toBeCloseTo(0.95, 5);
    expect(findWithinNearDup(near, keepers, 0.9).dup).toBe(true);
  });

  it('boundary: 0.899 keep, 0.901 drop at threshold 0.90', () => {
    const a = vec(1, 0);
    const keepers = [{ intent_text: 'a', embedding: a }];
    const justBelow = vec(0.899, Math.sqrt(1 - 0.899 * 0.899));
    const justAbove = vec(0.901, Math.sqrt(1 - 0.901 * 0.901));
    expect(cosineSimilarity(a, justBelow)).toBeCloseTo(0.899, 3);
    expect(cosineSimilarity(a, justAbove)).toBeCloseTo(0.901, 3);
    expect(findWithinNearDup(justBelow, keepers, 0.9).dup).toBe(false);
    expect(findWithinNearDup(justAbove, keepers, 0.9).dup).toBe(true);
  });

  it('classifyForeignHit ignores same command_id; flags other at 0.94+', () => {
    expect(
      classifyForeignHit(
        { command_id: 5, intent_text: 'x', similarity: 0.99 },
        5,
        0.94,
      ).collision,
    ).toBe(false);
    expect(
      classifyForeignHit(
        { command_id: 7, intent_text: 'x', similarity: 0.93 },
        5,
        0.94,
      ).collision,
    ).toBe(false);
    const hit = classifyForeignHit(
      { command_id: 7, intent_text: 'other', similarity: 0.94 },
      5,
      0.94,
    );
    expect(hit.collision).toBe(true);
    expect(hit.neighbor?.command_id).toBe(7);
  });

  it('findForeignCollision returns first foreign hit', () => {
    const r = findForeignCollision(
      [
        { command_id: 1, intent_text: 'self', similarity: 0.99 },
        { command_id: 2, intent_text: 'foreign', similarity: 0.95 },
      ],
      1,
      0.94,
    );
    expect(r.collision).toBe(true);
    expect(r.neighbor?.intent_text).toBe('foreign');
  });

  it('findForeignCollision ignores excludeCommandIds set (parent lineage)', () => {
    const excluded = new Set([1, 16]);
    const ignored = findForeignCollision(
      [{ command_id: 16, intent_text: 'parent intent', similarity: 0.99 }],
      excluded,
      0.94,
    );
    expect(ignored.collision).toBe(false);

    const other = findForeignCollision(
      [
        { command_id: 16, intent_text: 'parent', similarity: 0.99 },
        { command_id: 99, intent_text: 'unrelated', similarity: 0.95 },
      ],
      excluded,
      0.94,
    );
    expect(other.collision).toBe(true);
    expect(other.neighbor?.command_id).toBe(99);
  });

  it('dedupeBatchByCosine keeps first of near-dup cluster', () => {
    const a = vec(1, 0);
    const near = vec(0.95, Math.sqrt(1 - 0.95 * 0.95));
    const ortho = vec(0, 1);
    const out = dedupeBatchByCosine(
      [
        { intent_text: 'a', embedding: a },
        { intent_text: 'near', embedding: near },
        { intent_text: 'ortho', embedding: ortho },
      ],
      0.9,
    );
    expect(out.map((x) => x.intent_text)).toEqual(['a', 'ortho']);
  });
});
