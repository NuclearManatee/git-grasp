// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig } from '../../common/src/lib/config.js';
import { sendPosthogEvent } from '../../common/src/lib/telemetry/send.js';
import {
  maybeInviteAndTrackSearch,
  setTelemetryEnabled,
  telemetryStatus,
  telemetryStatusDetail,
  maybeRunTelemetryInvite,
  mintTelemetrySessionId,
} from '../../common/src/lib/telemetry/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-telemetry-send');

describe('telemetry send + invite', () => {
  const prevAppData = process.env.APPDATA;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevHost = process.env.GIT_GRASP_POSTHOG_HOST;
  const prevKey = process.env.GIT_GRASP_POSTHOG_KEY;
  const prevDnt = process.env.DO_NOT_TRACK;
  const prevTel = process.env.GIT_GRASP_TELEMETRY;
  const prevCi = process.env.CI;
  const prevBench = process.env.GIT_GRASP_BENCH;

  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') process.env.APPDATA = tmpRoot;
    else process.env.XDG_CONFIG_HOME = tmpRoot;
    process.env.GIT_GRASP_POSTHOG_HOST = 'http://127.0.0.1:3999';
    process.env.GIT_GRASP_POSTHOG_KEY = 'phc_test_key';
    delete process.env.DO_NOT_TRACK;
    delete process.env.GIT_GRASP_TELEMETRY;
    process.env.CI = '1';
    delete process.env.GIT_GRASP_BENCH;
  });

  afterEach(() => {
    for (const [k, v] of [
      ['APPDATA', prevAppData],
      ['XDG_CONFIG_HOME', prevXdg],
      ['GIT_GRASP_POSTHOG_HOST', prevHost],
      ['GIT_GRASP_POSTHOG_KEY', prevKey],
      ['DO_NOT_TRACK', prevDnt],
      ['GIT_GRASP_TELEMETRY', prevTel],
      ['CI', prevCi],
      ['GIT_GRASP_BENCH', prevBench],
    ]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('skips send when project key explicitly empty', async () => {
    process.env.GIT_GRASP_POSTHOG_KEY = '';
    const fetchImpl = mock();
    const r = await sendPosthogEvent({
      name: 'cli_search',
      data: {},
      fetchImpl,
      verbose: false,
    });
    expect(r.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('skips send when project key unset (baked empty)', async () => {
    delete process.env.GIT_GRASP_POSTHOG_KEY;
    process.env.GIT_GRASP_POSTHOG_HOST = 'http://127.0.0.1:3999';
    const fetchImpl = mock(async () => ({ ok: true }));
    const r = await sendPosthogEvent({
      name: 'cli_opt_in',
      data: { source: 'cli' },
      fetchImpl,
    });
    expect(r.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts to /i/v0/e/ when enabled path calls send', async () => {
    const fetchImpl = mock(async () => ({ ok: true }));
    const r = await sendPosthogEvent({
      name: 'cli_opt_in',
      data: { source: 'cli', session_id: 'sid-1' },
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3999/i/v0/e/');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.event).toBe('cli_opt_in');
    expect(body.api_key).toBe('phc_test_key');
    expect(body.distinct_id).toBe('sid-1');
    expect(body.properties.source).toBe('cli');
    expect(body.properties.$process_person_profile).toBe(false);
  });

  it('self-host falls back to /e/ after /i/v0/e/ 404', async () => {
    const fetchImpl = mock(async (url) => {
      if (String(url).endsWith('/i/v0/e/')) return { ok: false, status: 404 };
      if (String(url).endsWith('/e/')) return { ok: true, status: 200 };
      return { ok: false, status: 500 };
    });
    const r = await sendPosthogEvent({
      name: 'cli_opt_in',
      data: { source: 'cli' },
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      'http://127.0.0.1:3999/i/v0/e/',
      'http://127.0.0.1:3999/e/',
    ]);
  });

  it('verbose failure does not include query payload', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = mock(async () => {
      throw new Error('network down');
    });
    await sendPosthogEvent({
      name: 'cli_search',
      data: { query: 'secret-query-should-not-print', source: 'cli' },
      fetchImpl,
      verbose: true,
    });
    const msg = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(msg).toContain('telemetry: send failed:');
    expect(msg).not.toContain('secret-query-should-not-print');
    errSpy.mockRestore();
  });

  it('http error surfaces only status in verbose', async () => {
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = mock(async () => ({ ok: false, status: 500 }));
    await sendPosthogEvent({
      name: 'cli_search',
      data: { query: 'undo last commit keep files' },
      fetchImpl,
      verbose: true,
    });
    expect(errSpy.mock.calls[0][0]).toBe('telemetry: send failed: http 500');
    errSpy.mockRestore();
  });

  it('invite Yes enables and tracks this search', async () => {
    delete process.env.CI;
    const fetchImpl = mock(async () => ({ ok: true }));
    const out = await maybeInviteAndTrackSearch({
      query: 'undo commit',
      result: { status: 'ok', confidence: 'high', results: [], advanced: null },
      latencyMs: 10,
      mock: true,
      questionFn: async () => 'y',
      fetchImpl,
    });
    expect(readConfig().telemetry).toBe(true);
    expect(out.tracked).toBe(true);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2); // opt_in + search
    const names = fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body).event);
    expect(names).toContain('cli_opt_in');
    expect(names).toContain('cli_search');
  });

  it('invite dismiss persists and does not send', async () => {
    delete process.env.CI;
    const fetchImpl = mock(async () => ({ ok: true }));
    await maybeInviteAndTrackSearch({
      query: 'x',
      result: { status: 'ok', results: [] },
      latencyMs: 1,
      questionFn: async () => 'd',
      fetchImpl,
    });
    expect(readConfig().telemetryInvite).toBe('dismissed');
    expect(readConfig().telemetry).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('invite No sets telemetry false', async () => {
    delete process.env.CI;
    const fetchImpl = mock();
    await maybeInviteAndTrackSearch({
      query: 'x',
      result: { status: 'ok', results: [] },
      latencyMs: 1,
      questionFn: async () => 'n',
      fetchImpl,
    });
    expect(readConfig().telemetry).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('setTelemetryEnabled on/off', () => {
    setTelemetryEnabled(true);
    expect(readConfig().telemetry).toBe(true);
    setTelemetryEnabled(false);
    expect(readConfig().telemetry).toBe(false);
    expect(readConfig().telemetryInvite).toBe('dismissed');
  });

  it('hard-off no-ops send and refuses enable', async () => {
    process.env.DO_NOT_TRACK = '1';
    const fetchImpl = mock();
    const r = await sendPosthogEvent({
      name: 'cli_search',
      data: { query: 'status' },
      fetchImpl,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('hard-off');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(() => setTelemetryEnabled(true)).toThrow(/hard-off/i);
  });

  it('scrubs PII queries before send', async () => {
    const fetchImpl = mock(async () => ({ ok: true }));
    const r = await sendPosthogEvent({
      name: 'cli_search',
      data: { query: 'mail me at a@b.com please' },
      fetchImpl,
    });
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/^scrub:/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('status helpers and skip invite', async () => {
    expect(telemetryStatus({ telemetry: false }, {})).toBe('off');
    expect(telemetryStatusDetail({ telemetry: true }, {}).label).toBe('on');
    expect(mintTelemetrySessionId()).toMatch(/-/);
    const fetchImpl = mock();
    const skipped = await maybeRunTelemetryInvite({ skipInvite: true });
    expect(skipped).toBe(false);
    await maybeInviteAndTrackSearch({
      query: 'status',
      result: { status: 'ok', results: [] },
      latencyMs: 1,
      skipInvite: true,
      fetchImpl,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('times out hanging fetch', async () => {
    const fetchImpl = mock((_url, init) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));
    const r = await sendPosthogEvent({
      name: 'cli_search',
      data: { query: 'undo last commit keep files' },
      fetchImpl,
      verbose: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/timeout|abort/i);
  });

  it('tracks when already enabled and mints a session', async () => {
    setTelemetryEnabled(true);
    writeConfig({ telemetrySessionId: null });
    const fetchImpl = mock(async () => ({ ok: true }));
    const out = await maybeInviteAndTrackSearch({
      query: 'status please',
      result: { status: 'ok', results: [], displayResults: [] },
      latencyMs: 3,
      skipInvite: true,
      fetchImpl,
    });
    expect(out.tracked).toBe(true);
    expect(readConfig().telemetrySessionId).toBeTruthy();
    expect(await maybeRunTelemetryInvite()).toBe(true);
  });
});
