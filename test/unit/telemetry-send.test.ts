// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig } from '../../common/src/lib/config.js';
import { sendUmamiEvent } from '../../common/src/lib/telemetry/send.js';
import {
  maybeInviteAndTrackSearch,
  setTelemetryEnabled,
} from '../../common/src/lib/telemetry/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-telemetry-send');

describe('telemetry send + invite', () => {
  const prevAppData = process.env.APPDATA;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  const prevHost = process.env.GIT_GRASP_UMAMI_HOST;
  const prevId = process.env.GIT_GRASP_UMAMI_WEBSITE_ID;
  const prevDnt = process.env.DO_NOT_TRACK;
  const prevTel = process.env.GIT_GRASP_TELEMETRY;
  const prevCi = process.env.CI;
  const prevBench = process.env.GIT_GRASP_BENCH;

  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') process.env.APPDATA = tmpRoot;
    else process.env.XDG_CONFIG_HOME = tmpRoot;
    process.env.GIT_GRASP_UMAMI_HOST = 'http://127.0.0.1:3999';
    process.env.GIT_GRASP_UMAMI_WEBSITE_ID = 'test-website-id';
    delete process.env.DO_NOT_TRACK;
    delete process.env.GIT_GRASP_TELEMETRY;
    process.env.CI = '1'; // no interactive invite in these tests unless overridden
    delete process.env.GIT_GRASP_BENCH;
  });

  afterEach(() => {
    for (const [k, v] of [
      ['APPDATA', prevAppData],
      ['XDG_CONFIG_HOME', prevXdg],
      ['GIT_GRASP_UMAMI_HOST', prevHost],
      ['GIT_GRASP_UMAMI_WEBSITE_ID', prevId],
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

  it('skips send when website id explicitly empty', async () => {
    process.env.GIT_GRASP_UMAMI_WEBSITE_ID = '';
    const fetchImpl = vi.fn();
    const r = await sendUmamiEvent({
      name: 'cli_search',
      data: {},
      fetchImpl,
      verbose: false,
    });
    expect(r.skipped).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses baked website id when env unset', async () => {
    delete process.env.GIT_GRASP_UMAMI_WEBSITE_ID;
    process.env.GIT_GRASP_UMAMI_HOST = 'http://127.0.0.1:3999';
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const r = await sendUmamiEvent({
      name: 'cli_opt_in',
      data: { source: 'cli' },
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.payload.website).toBe('de9735ab-4e95-479d-abf8-c52f7979e2aa');
  });

  it('posts to /api/send when enabled path calls send', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const r = await sendUmamiEvent({
      name: 'cli_opt_in',
      data: { source: 'cli' },
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:3999/api/send');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.type).toBe('event');
    expect(body.payload.name).toBe('cli_opt_in');
    expect(body.payload.website).toBe('test-website-id');
  });

  it('verbose failure does not include query payload', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await sendUmamiEvent({
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
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
    await sendUmamiEvent({
      name: 'cli_search',
      data: { query: 'q' },
      fetchImpl,
      verbose: true,
    });
    expect(errSpy.mock.calls[0][0]).toBe('telemetry: send failed: http 500');
    errSpy.mockRestore();
  });

  it('invite Yes enables and tracks this search', async () => {
    delete process.env.CI;
    const fetchImpl = vi.fn(async () => ({ ok: true }));
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
    const names = fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body).payload.name);
    expect(names).toContain('cli_opt_in');
    expect(names).toContain('cli_search');
  });

  it('invite dismiss persists and does not send', async () => {
    delete process.env.CI;
    const fetchImpl = vi.fn(async () => ({ ok: true }));
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
    const fetchImpl = vi.fn();
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
  });
});
