import { describe, expect, it } from 'vitest';
import {
  evaluateQuery,
  hitAtDisplay,
  displayedFromSearchOutput,
} from '../../../packages/core/src/build/evalGate.ts';

describe('Hit@display uses CLI displayResults', () => {
  it('displayedFromSearchOutput prefers displayResults over results', () => {
    const out = displayedFromSearchOutput({
      results: [{ command_id: 1 }, { command_id: 2 }, { command_id: 3 }, { command_id: 4 }],
      displayResults: [{ command_id: 9 }],
      status: 'ok',
      confidence: 0.95,
      alert: 'none',
    });
    expect(out.map((h) => h.command_id)).toEqual([9]);
  });

  it('hitAtDisplay false when gold in internal results but display empty', () => {
    expect(
      hitAtDisplay(
        {
          results: [{ command_id: 9 }, { command_id: 8 }, { command_id: 7 }],
          displayResults: [],
          status: 'empty',
          alert: 'red',
        },
        9,
      ),
    ).toBe(false);
  });

  it('hitAtDisplay true when gold in displayResults', () => {
    expect(
      hitAtDisplay(
        {
          results: [{ command_id: 1 }, { command_id: 2 }, { command_id: 9 }],
          displayResults: [{ command_id: 9 }],
        },
        9,
      ),
    ).toBe(true);
  });

  it('hitAtDisplay false when gold only at internal rank beyond display', () => {
    expect(
      hitAtDisplay(
        {
          results: [
            { command_id: 1 },
            { command_id: 2 },
            { command_id: 3 },
            { command_id: 9 },
          ],
          displayResults: [{ command_id: 1 }, { command_id: 2 }],
        },
        9,
      ),
    ).toBe(false);
  });

  it('evaluateQuery does not auto-pass when gold only in internal results', async () => {
    const verdict = await evaluateQuery(
      { query_text: 'undo last commit', command_id: 42 },
      async () => ({
        results: [{ command_id: 42, example: 'git reset' }, { command_id: 1 }],
        displayResults: [],
        status: 'empty',
        confidence: 0.2,
        alert: 'red',
      }),
      {
        llmJsonObject: async () => ({ utility: 0.1, reason: 'empty for clear git intent' }),
      },
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.via).toBe('ko');
    expect(verdict.displayed).toEqual([]);
  });

  it('evaluateQuery passes via hit@display when gold is shown', async () => {
    const verdict = await evaluateQuery(
      { query_text: 'undo', command_id: 42 },
      async () => ({
        results: [{ command_id: 42, example: 'git reset' }, { command_id: 1 }],
        displayResults: [{ command_id: 42, example: 'git reset' }],
        status: 'ok',
        confidence: 0.95,
        alert: 'none',
      }),
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.via).toBe('hit@display');
  });

  it('empty/red + off-topic query can pass via utility judge', async () => {
    const verdict = await evaluateQuery(
      { query_text: 'what time is it', command_id: 1 },
      async () => ({
        results: [{ command_id: 1 }],
        displayResults: [],
        status: 'empty',
        confidence: 0.1,
        alert: 'red',
      }),
      {
        llmJsonObject: async () => ({
          utility: 0.95,
          reason: 'correct abstention for non-git query',
        }),
      },
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.via).toBe('judge');
    expect(verdict.utility).toBe(0.95);
  });

  it('empty/red + git golden query fails via utility judge', async () => {
    const verdict = await evaluateQuery(
      { query_text: 'show working tree status', command_id: 7 },
      async () => ({
        results: [{ command_id: 7 }],
        displayResults: [],
        status: 'empty',
        confidence: 0.1,
        alert: 'red',
      }),
      {
        llmJsonObject: async () => ({
          utility: 0.2,
          reason: 'clear git intent deserved a candidate',
        }),
      },
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.via).toBe('ko');
  });
});
