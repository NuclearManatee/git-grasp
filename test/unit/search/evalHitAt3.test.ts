import { describe, expect, it } from 'vitest';
import {
  evaluateQuery,
  hitAt3,
  top3FromSearchOutput,
} from '../../../packages/core/src/build/evalGate.ts';

describe('Hit@3 uses internal results', () => {
  it('top3FromSearchOutput prefers results over displayResults', () => {
    const out = top3FromSearchOutput({
      results: [{ command_id: 1 }, { command_id: 2 }, { command_id: 3 }, { command_id: 4 }],
      displayResults: [],
      status: 'empty',
      confidence: 0.1,
    });
    expect(out.map((h) => h.command_id)).toEqual([1, 2, 3]);
  });

  it('hitAt3 true when gold in internal top3 even if display empty', () => {
    expect(
      hitAt3(
        {
          results: [{ command_id: 9 }, { command_id: 8 }, { command_id: 7 }],
          displayResults: [],
        },
        9,
      ),
    ).toBe(true);
  });

  it('hitAt3 false when gold at rank 4', () => {
    expect(
      hitAt3(
        {
          results: [
            { command_id: 1 },
            { command_id: 2 },
            { command_id: 3 },
            { command_id: 9 },
          ],
        },
        9,
      ),
    ).toBe(false);
  });

  it('evaluateQuery passes via hit@3 on hybrid result shape', async () => {
    const verdict = await evaluateQuery(
      { query_text: 'undo', command_id: 42 },
      async () => ({
        results: [{ command_id: 42, example: 'git reset' }, { command_id: 1 }],
        displayResults: [],
        status: 'empty',
        confidence: 0.2,
      }),
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.via).toBe('hit@3');
  });
});
