// @ts-nocheck
import { describe, it, expect } from 'bun:test';
import { filterSearchEvents, piiOrJunkReason } from '../../common/src/evolve/filter.js';

function ev(partial) {
  return {
    id: partial.id || 'e1',
    name: partial.name || 'cli_search',
    createdAt: partial.createdAt || Date.now(),
    sessionId: partial.sessionId,
    data: {
      query: partial.query,
      mock: partial.mock,
      catalog_version: partial.catalog_version ?? 5,
      session_id: partial.session_id,
      response: partial.response || { status: 'empty', confidence: 0, displayCount: 0, results: [] },
      ...partial.data,
    },
  };
}

describe('evolve filter', () => {
  it('drops mock, empty, non-search', () => {
    const { events, drop_reasons } = filterSearchEvents([
      ev({ id: '1', query: 'undo commit' }),
      ev({ id: '2', query: 'x', mock: true }),
      ev({ id: '3', query: '' }),
      { id: '4', name: 'cli_opt_in', data: {} },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].query).toBe('undo commit');
    expect(drop_reasons.mock).toBe(1);
    expect(drop_reasons.empty).toBe(1);
    expect(drop_reasons.not_search).toBe(1);
  });

  it('drops PII and spam aggressively', () => {
    expect(piiOrJunkReason('mail me at a@b.com please')).toBe('pii_email');
    expect(piiOrJunkReason('token ghp_abcdefghijklmnopqrstuvwxyz012345')).toBe('pii_token');
    expect(piiOrJunkReason('open /Users/alice/secret')).toBe('pii_home_path');
    expect(piiOrJunkReason('see http://127.0.0.1:3000/x')).toBe('pii_private_url');
    expect(piiOrJunkReason('!!!!!!!!!!')).toBe('non_text');
    expect(piiOrJunkReason('aaaaaaaaaa')).toBe('spam_repeat');
    const { drop_reasons } = filterSearchEvents([
      ev({ id: 'a', query: 'contact foo@bar.com' }),
      ev({ id: 'b', query: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' }),
      ev({ id: 'c', query: 'aaaaaaaaaa' }),
    ]);
    expect(drop_reasons.pii_email).toBe(1);
    expect(drop_reasons.pii_token).toBe(1);
    expect(drop_reasons.spam_repeat).toBe(1);
  });

  it('drops burst identical repeats', () => {
    const t = 1_700_000_000_000;
    const { events, drop_reasons } = filterSearchEvents([
      ev({ id: '1', query: 'undo', createdAt: t, session_id: 's1' }),
      ev({ id: '2', query: 'undo', createdAt: t + 200, session_id: 's1' }),
      ev({ id: '3', query: 'undo soft', createdAt: t + 400, session_id: 's1' }),
    ]);
    expect(events).toHaveLength(2);
    expect(drop_reasons.burst_repeat).toBe(1);
  });

  it('partitions by catalog_version', () => {
    const { events, catalog_version } = filterSearchEvents(
      [
        ev({ id: '1', query: 'alpha undo', catalog_version: 5 }),
        ev({ id: '2', query: 'beta stash', catalog_version: 4 }),
        ev({ id: '3', query: 'gamma rebase', catalog_version: 5 }),
      ],
      { catalogVersion: 5 },
    );
    expect(catalog_version).toBe(5);
    expect(events).toHaveLength(2);
  });
});
