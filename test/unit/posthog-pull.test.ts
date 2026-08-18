// @ts-nocheck
import { describe, it, expect, mock } from 'bun:test';
import {
  derivePosthogApiHost,
  hogqlRowsFromQueryJson,
  mapPosthogEventRow,
  parsePosthogProperties,
  pullPosthogEvents,
  resolvePosthogPullConfig,
  dedupeAfterLastEventId,
  mergeSetCookie,
  ensurePosthogE2eProject,
} from '../../common/src/evolve/posthogPull.js';

describe('posthog pull', () => {
  it('derives query API host from ingest host', () => {
    expect(derivePosthogApiHost('https://eu.i.posthog.com')).toBe('https://eu.posthog.com');
    expect(derivePosthogApiHost('https://us.i.posthog.com')).toBe('https://us.posthog.com');
    expect(derivePosthogApiHost('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000');
    expect(derivePosthogApiHost('http://127.0.0.1:8010')).toBe('http://127.0.0.1:8010');
  });

  it('resolves pull config from env', () => {
    const cfg = resolvePosthogPullConfig({
      GIT_GRASP_POSTHOG_HOST: 'https://eu.i.posthog.com',
      GIT_GRASP_POSTHOG_PROJECT_ID: '123',
      GIT_GRASP_POSTHOG_PERSONAL_API_KEY: 'phx_secret',
    });
    expect(cfg.apiHost).toBe('https://eu.posthog.com');
    expect(cfg.projectId).toBe('123');
    expect(cfg.personalApiKey).toBe('phx_secret');
  });

  it('maps HogQL tuple rows', () => {
    const rows = hogqlRowsFromQueryJson({
      columns: ['uuid', 'event', 'timestamp', 'distinct_id', 'properties'],
      results: [
        [
          'evt-1',
          'cli_search',
          '2026-08-17 12:00:00',
          'sid-1',
          { query: 'undo commit', session_id: 'sid-1' },
        ],
      ],
    });
    expect(rows).toHaveLength(1);
    const mapped = mapPosthogEventRow(rows[0]);
    expect(mapped.id).toBe('evt-1');
    expect(mapped.name).toBe('cli_search');
    expect(mapped.sessionId).toBe('sid-1');
    expect(mapped.data.query).toBe('undo commit');
  });

  it('parses properties JSON strings', () => {
    expect(parsePosthogProperties('{"query":"x"}')).toEqual({ query: 'x' });
    expect(parsePosthogProperties({ query: 'y' })).toEqual({ query: 'y' });
  });

  it('dedupes after last event id', () => {
    const events = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(dedupeAfterLastEventId(events, 'b').map((e) => e.id)).toEqual(['c']);
  });

  it('pulls via HogQL query API', async () => {
    const fetchImpl = mock(async (url, init) => {
      expect(url).toBe('https://eu.posthog.com/api/projects/99/query/');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer phx_test');
      const body = JSON.parse(init.body);
      expect(body.query.kind).toBe('HogQLQuery');
      expect(body.query.query).toContain('cli_search');
      return {
        ok: true,
        json: async () => ({
          columns: ['uuid', 'event', 'timestamp', 'distinct_id', 'properties'],
          results: [
            ['id-1', 'cli_search', '2026-08-17T12:00:00Z', 's1', { query: 'status' }],
          ],
        }),
      };
    });
    const result = await pullPosthogEvents({
      apiHost: 'https://eu.posthog.com',
      projectId: '99',
      personalApiKey: 'phx_test',
      sinceIso: '2026-08-01T00:00:00.000Z',
      fetchImpl,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].name).toBe('cli_search');
    expect(result.events[0].data.query).toBe('status');
  });

  it('merges Set-Cookie into a Cookie header', () => {
    const headers = {
      getSetCookie: () => ['sessionid=abc; Path=/', 'csrftoken=xyz; HttpOnly'],
    };
    expect(mergeSetCookie('a=1', headers)).toBe('a=1; sessionid=abc; csrftoken=xyz');
    expect(mergeSetCookie('', { get: (n) => (n === 'set-cookie' ? 'ph=1; Path=/' : null) })).toBe(
      'ph=1',
    );
  });

  it('ensures a local e2e project via login/signup', async () => {
    const fetchImpl = mock(async (url, init) => {
      if (String(url).endsWith('/api/login/')) {
        return { ok: false, status: 400, headers: { getSetCookie: () => [] }, json: async () => ({}) };
      }
      if (String(url).endsWith('/api/signup/')) {
        return {
          ok: true,
          status: 201,
          headers: { getSetCookie: () => ['sessionid=e2e; Path=/'] },
          json: async () => ({}),
        };
      }
      if (String(url).endsWith('/api/projects/') && !init?.method) {
        expect(init.headers.Cookie).toContain('sessionid=e2e');
        return {
          ok: true,
          json: async () => ({ results: [{ id: 42, api_token: 'phc_local' }] }),
        };
      }
      if (String(url).endsWith('/api/personal_api_keys/')) {
        expect(init.method).toBe('POST');
        return { ok: true, json: async () => ({ value: 'phx_local' }) };
      }
      throw new Error(`unexpected ${url}`);
    });
    const seeded = await ensurePosthogE2eProject({
      host: 'http://127.0.0.1:8010',
      fetchImpl,
    });
    expect(seeded).toEqual({
      projectId: '42',
      projectApiKey: 'phc_local',
      personalApiKey: 'phx_local',
    });
  });

  it('throws when project id missing', async () => {
    await expect(
      pullPosthogEvents({
        apiHost: 'https://eu.posthog.com',
        personalApiKey: 'phx_test',
        fetchImpl: mock(),
      }),
    ).rejects.toThrow(/PROJECT_ID/);
  });
});
