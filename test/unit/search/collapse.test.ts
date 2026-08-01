import { describe, expect, it } from 'vitest';
import { collapseToCommands } from '../../../packages/core/src/search/collapse.ts';

describe('collapseToCommands Q12-D', () => {
  it('picks exact preferred skill intent for vector score', () => {
    const intentHits = [
      {
        command_id: 1,
        skill_level_text: 'expert',
        intent_text: 'expert undo',
        intent_category: 'goal',
        _forcedScore: 0.9,
        commands: [{ command: 'git reset --hard' }],
        risk: 0.8,
      },
      {
        command_id: 1,
        skill_level_text: 'beginner',
        intent_text: 'beginner undo',
        intent_category: 'goal',
        _forcedScore: 0.5,
        commands: [{ command: 'git reset --hard' }],
        risk: 0.8,
      },
    ];
    const out = collapseToCommands(intentHits, [], 'beginner');
    expect(out).toHaveLength(1);
    expect(out[0].command_id).toBe(1);
    expect(out[0].rawCosine).toBe(0.5);
    expect(out[0].intent_text).toBe('beginner undo');
  });

  it('falls back to closest skill rank then best sim', () => {
    const intentHits = [
      {
        command_id: 2,
        skill_level_text: 'nontechnical',
        intent_text: 'nt',
        _forcedScore: 0.4,
        commands: [{ command: 'git status' }],
        risk: 0,
      },
      {
        command_id: 2,
        skill_level_text: 'expert',
        intent_text: 'ex',
        _forcedScore: 0.99,
        commands: [{ command: 'git status' }],
        risk: 0,
      },
    ];
    // preferred intermediate: expert is closer (rank 4 vs 3) than nontechnical (1)
    const out = collapseToCommands(intentHits, [], 'intermediate');
    expect(out[0].intent_text).toBe('ex');
    expect(out[0].rawCosine).toBe(0.99);
  });

  it('merges FTS-only commands with bm25', () => {
    const out = collapseToCommands(
      [],
      [{ command_id: 7, bm25: -3.5 }],
      'beginner',
    );
    expect(out).toHaveLength(1);
    expect(out[0].command_id).toBe(7);
    expect(out[0].rawBm25).toBe(-3.5);
    expect(out[0].rawCosine).toBeNull();
  });

  it('unions vec + fts on same command_id', () => {
    const out = collapseToCommands(
      [
        {
          command_id: 3,
          skill_level_text: 'beginner',
          intent_text: 'x',
          _forcedScore: 0.8,
          commands: [{ command: 'git stash' }],
          risk: 0.1,
        },
      ],
      [{ command_id: 3, bm25: -2 }],
      'beginner',
    );
    expect(out).toHaveLength(1);
    expect(out[0].rawCosine).toBe(0.8);
    expect(out[0].rawBm25).toBe(-2);
  });
});
