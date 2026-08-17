import { describe, expect, it } from 'bun:test';
import { collapseToCommands } from '../../../common/src/search/collapse.ts';

describe('collapseToCommands (description KNN)', () => {
  it('picks highest cosine when multiple hits share an id', () => {
    const knnHits = [
      {
        command_id: 'r1',
        description: 'low',
        _forcedScore: 0.5,
        commands: [{ command: 'git reset --hard' }],
        risk: 0.8,
      },
      {
        command_id: 'r1',
        description: 'high',
        _forcedScore: 0.9,
        commands: [{ command: 'git reset --hard' }],
        risk: 0.8,
      },
    ];
    const out = collapseToCommands(knnHits, []);
    expect(out).toHaveLength(1);
    expect(out[0].command_id).toBe('r1');
    expect(out[0].rawCosine).toBe(0.9);
    expect(out[0].description).toBe('high');
  });

  it('merges FTS-only recipes with bm25', () => {
    const out = collapseToCommands([], [{ command_id: 'r7', bm25: -3.5 }]);
    expect(out).toHaveLength(1);
    expect(out[0].command_id).toBe('r7');
    expect(out[0].rawBm25).toBe(-3.5);
    expect(out[0].rawCosine).toBeNull();
  });

  it('unions vec + fts on same recipe id', () => {
    const out = collapseToCommands(
      [
        {
          command_id: 'r3',
          description: 'stash work',
          _forcedScore: 0.8,
          commands: [{ command: 'git stash' }],
          risk: 0.1,
        },
      ],
      [{ recipe_id: 'r3', bm25: -2 }],
    );
    expect(out).toHaveLength(1);
    expect(out[0].rawCosine).toBe(0.8);
    expect(out[0].rawBm25).toBe(-2);
  });
});
