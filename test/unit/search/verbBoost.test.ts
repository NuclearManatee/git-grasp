import { describe, expect, it } from 'vitest';
import {
  PRIMARY_VERB_BOOST,
  applyPrimaryVerbBoost,
  primaryVerbTokenFromHit,
  queryNamesPrimaryVerb,
} from '../../../common/src/search/verbBoost.ts';

describe('verbBoost', () => {
  it('primaryVerbTokenFromHit reads example / first command', () => {
    expect(primaryVerbTokenFromHit({ example: 'git diff' })).toBe('diff');
    expect(
      primaryVerbTokenFromHit({
        commands: [{ command: 'git difftool --no-prompt' }],
      }),
    ).toBe('difftool');
  });

  it('queryNamesPrimaryVerb matches token in query', () => {
    expect(queryNamesPrimaryVerb('show unstaged with git diff', 'diff')).toBe(true);
    expect(queryNamesPrimaryVerb('show unstaged with git diff', 'difftool')).toBe(false);
    expect(queryNamesPrimaryVerb('how are you', 'diff')).toBe(false);
  });

  it('applyPrimaryVerbBoost lifts named primary above sibling', () => {
    const out = applyPrimaryVerbBoost(
      [
        {
          command_id: 2,
          score: 0.9,
          example: 'git difftool --no-prompt --tool echo',
          commands: [{ command: 'git difftool --no-prompt --tool echo' }],
        },
        {
          command_id: 1,
          score: 0.8,
          example: 'git diff',
          commands: [{ command: 'git diff' }],
        },
      ],
      'show unstaged changes with git diff',
      ['diff', 'difftool'],
    );
    const byId = Object.fromEntries(out.map((h) => [h.command_id, h]));
    expect(byId[1].score).toBeCloseTo(Math.min(1, 0.8 + PRIMARY_VERB_BOOST));
    expect(byId[2].score).toBe(0.9); // no boost for difftool when query says diff
    expect(byId[1].score).toBeGreaterThan(byId[2].score);
  });

  it('no boost when query has no verb token', () => {
    const out = applyPrimaryVerbBoost(
      [{ command_id: 1, score: 0.5, example: 'git status' }],
      'what is going on in my project',
      ['status'],
    );
    expect(out[0].score).toBe(0.5);
    expect(out[0].score_verb_boost).toBe(0);
  });
});
