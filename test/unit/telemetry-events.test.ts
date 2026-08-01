// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  buildCliOptInEvent,
  buildCliSearchEvent,
  searchResponseFromResult,
  searchResponseFromError,
} from '../../common/src/lib/telemetry/events.js';

describe('telemetry events', () => {
  it('cli_opt_in shape', () => {
    const ev = buildCliOptInEvent();
    expect(ev.name).toBe('cli_opt_in');
    expect(ev.data.source).toBe('cli');
    expect(ev.data.app_version).toBeTruthy();
    expect(ev.data.os).toBeTruthy();
    expect(ev.data).not.toHaveProperty('install_id');
  });

  it('cli_search mirrors web fields', () => {
    const result = {
      status: 'ok',
      confidence: 0.9,
      displayResults: [
        {
          command_id: 1,
          command: 'git reset',
          example: 'git reset --soft HEAD~1',
          score: 0.9,
          skill_level: 'beginner',
        },
      ],
      results: [],
      blend: { alpha: 0.7, beta: 0.3 },
    };
    const response = searchResponseFromResult(result);
    const ev = buildCliSearchEvent({
      query: 'undo commit',
      response,
      latency_ms: 42,
      mock: true,
    });
    expect(ev.name).toBe('cli_search');
    expect(ev.data.query).toBe('undo commit');
    expect(ev.data.latency_ms).toBe(42);
    expect(ev.data.mock).toBe(true);
    expect(ev.data.source).toBe('cli');
    expect(ev.data.response.results[0].command).toBe('git reset');
    expect(ev.data.response.displayCount).toBe(1);
  });

  it('error response shape', () => {
    const err = new Error('boom');
    err.code = 'CONFIG';
    expect(searchResponseFromError(err)).toEqual({
      status: 'error',
      error: 'boom',
      code: 'CONFIG',
    });
  });
});
