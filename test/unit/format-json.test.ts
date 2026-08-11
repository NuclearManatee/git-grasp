import { describe, it, expect } from 'vitest';
import {
  formatSearchResultJson,
} from '../../common/src/ux/format.js';

describe('formatSearchResultJson', () => {
  it('maps hits to a stable shape', () => {
    const json = formatSearchResultJson({
      status: 'ok',
      query: 'undo commit',
      confidence: 0.9,
      alert: 'none',
      blend: { alpha: 0.5, beta: 0.5 },
      displayResults: [
        {
          id: 'r1',
          example: 'git reset --soft HEAD~1',
          intent_description: 'Undo commit keep files',
          commands: [{ command: 'git reset --soft HEAD~1', comment: 'soft' }],
          score: 0.88,
          skill_level: 1,
          risk: 0.1,
        },
      ],
    });
    expect(json.status).toBe('ok');
    expect(json.query).toBe('undo commit');
    expect(json.results).toHaveLength(1);
    expect(json.results[0].title).toContain('reset');
    expect(json.results[0].commands[0].command).toContain('git reset');
    expect(json.results[0].score).toBe(0.88);
  });

  it('handles empty results', () => {
    const json = formatSearchResultJson({
      status: 'empty',
      displayResults: [],
    });
    expect(json.status).toBe('empty');
    expect(json.alert).toBe('red');
    expect(json.results).toEqual([]);
  });
});
