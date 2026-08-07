import { describe, it, expect } from 'vitest';
import {
  detectGaps,
  candidatesFromSearchOutput,
} from '../../../common/src/build/evalRecovery/detectGaps.ts';

describe('candidatesFromSearchOutput', () => {
  it('prefers results over displayResults', () => {
    const c = candidatesFromSearchOutput(
      {
        results: [
          { command_id: 1, title: 'A', snippet: 'git a' },
          { command_id: 2, title: 'B', snippet: 'git b' },
        ],
        displayResults: [{ command_id: 9, title: 'X' }],
      },
      10,
    );
    expect(c).toHaveLength(2);
    expect(c[0].command_id).toBe(1);
  });

  it('falls back to displayResults and bare arrays', () => {
    expect(
      candidatesFromSearchOutput({
        displayResults: [{ command_id: 3, example: 'git status' }],
      }),
    ).toEqual([
      {
        command_id: 3,
        title: 'git status',
        example: 'git status',
        snippet: '',
      },
    ]);
    expect(candidatesFromSearchOutput([{ command_id: 4, snippet: 'git log' }])).toEqual([
      { command_id: 4, title: '', example: '', snippet: 'git log' },
    ]);
  });
});

describe('detectGaps', () => {
  it('reclassifies no-verb miss as coverage_gap when judge finds no match', async () => {
    const classified = [
      {
        class: 'retrieval_sibling',
        command_id: 10,
        query_text: 'update my branch without losing local edits',
        primary_verb: 'git stash',
        row: {
          query: {
            command_id: 10,
            query_text: 'update my branch without losing local edits',
            primary_verb: 'git stash',
          },
        },
      },
    ];
    const { classified: out, checks } = await detectGaps(classified, {
      searchFn: async () => ({
        results: [
          {
            command_id: 1,
            title: 'Stash changes',
            snippet: 'git stash push',
            example: 'git stash push',
          },
        ],
      }),
      llmJsonObject: async () => ({ match_command_id: null }),
    });
    expect(out[0].class).toBe('coverage_gap');
    expect(out[0].gap_via).toBe('gap_check_none');
    expect(checks[0].class).toBe('coverage_gap');
  });

  it('keeps retrieval_sibling when judge finds a matching recipe', async () => {
    const classified = [
      {
        class: 'other',
        command_id: 10,
        query_text: 'save my uncommitted work before switching',
        primary_verb: 'git stash',
      },
    ];
    const { classified: out, checks } = await detectGaps(classified, {
      searchFn: async () => ({
        results: [
          {
            command_id: 42,
            title: 'Stash before switch',
            snippet: 'git stash\ngit switch other',
          },
        ],
      }),
      llmJsonObject: async () => ({ match_command_id: 42 }),
    });
    expect(out[0].class).toBe('retrieval_sibling');
    expect(out[0].gap_match_command_id).toBe(42);
    expect(checks[0].reason).toBe('match');
  });

  it('skips queries that already name two git verbs', async () => {
    const classified = [
      {
        class: 'retrieval_sibling',
        command_id: 1,
        query_text: 'git stash then git pull --rebase',
        primary_verb: 'git stash',
      },
    ];
    let searches = 0;
    const { classified: out, checks } = await detectGaps(classified, {
      searchFn: async () => {
        searches += 1;
        return { results: [] };
      },
      llmJsonObject: async () => ({ match_command_id: null }),
    });
    expect(searches).toBe(0);
    expect(out[0].class).toBe('retrieval_sibling');
    expect(checks).toHaveLength(0);
  });

  it('respects maxChecks cap', async () => {
    const classified = [
      {
        class: 'retrieval_sibling',
        command_id: 1,
        query_text: 'goal shaped ask one',
      },
      {
        class: 'other',
        command_id: 2,
        query_text: 'goal shaped ask two',
      },
      {
        class: 'retrieval_sibling',
        command_id: 3,
        query_text: 'goal shaped ask three',
      },
    ];
    let searches = 0;
    await detectGaps(classified, {
      maxChecks: 2,
      searchFn: async () => {
        searches += 1;
        return {
          results: [{ command_id: 9, title: 'X', snippet: 'git status' }],
        };
      },
      llmJsonObject: async () => ({ match_command_id: null }),
    });
    expect(searches).toBe(2);
  });

  it('empty retrieve becomes coverage_gap without LLM', async () => {
    const { classified: out, checks } = await detectGaps(
      [
        {
          class: 'retrieval_sibling',
          command_id: 1,
          query_text: 'move last commit onto another branch',
        },
      ],
      {
        searchFn: async () => ({ results: [], displayResults: [] }),
        llmJsonObject: async () => {
          throw new Error('should not call');
        },
      },
    );
    expect(out[0].class).toBe('coverage_gap');
    expect(checks[0].reason).toBe('empty_retrieve');
  });
});
