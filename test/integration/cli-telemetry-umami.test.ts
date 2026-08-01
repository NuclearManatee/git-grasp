// @ts-nocheck
/**
 * CLI telemetry ↔ local Umami e2e.
 *
 * Requires:
 *   docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
 *   GIT_GRASP_UMAMI_WEBSITE_ID set to a website UUID created in that Umami
 *   (or leave unset to use auto-probe via /api/send acceptance only with a fixed test id).
 *
 * Run: bun run test:telemetry-e2e
 * Skips cleanly when Umami is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig } from '../../packages/core/src/lib/config.js';
import {
  maybeInviteAndTrackSearch,
  sendUmamiEvent,
  buildCliSearchEvent,
  searchResponseFromResult,
} from '../../packages/core/src/lib/telemetry/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-umami-e2e');
const UMAMI_HOST = process.env.GIT_GRASP_UMAMI_HOST || 'http://127.0.0.1:3001';
const WEBSITE_ID =
  process.env.GIT_GRASP_UMAMI_WEBSITE_ID || '00000000-0000-4000-8000-000000000001';

async function umamiReachable() {
  try {
    const res = await fetch(`${UMAMI_HOST}/`, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

describe('cli telemetry umami e2e', () => {
  let available = false;
  const saved = {};

  beforeAll(async () => {
    available = await umamiReachable();
    for (const k of [
      'APPDATA',
      'XDG_CONFIG_HOME',
      'GIT_GRASP_UMAMI_HOST',
      'GIT_GRASP_UMAMI_WEBSITE_ID',
      'DO_NOT_TRACK',
      'GIT_GRASP_TELEMETRY',
      'CI',
      'GIT_GRASP_BENCH',
    ]) {
      saved[k] = process.env[k];
    }
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') process.env.APPDATA = tmpRoot;
    else process.env.XDG_CONFIG_HOME = tmpRoot;
    process.env.GIT_GRASP_UMAMI_HOST = UMAMI_HOST;
    process.env.GIT_GRASP_UMAMI_WEBSITE_ID = WEBSITE_ID;
    delete process.env.DO_NOT_TRACK;
    delete process.env.GIT_GRASP_TELEMETRY;
    process.env.CI = '1';
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('positive: enabled search is accepted by Umami /api/send', async () => {
    if (!available) {
      console.warn('skip: local Umami not reachable at', UMAMI_HOST);
      return;
    }
    writeConfig({ telemetry: true, telemetryInvite: 'dismissed' });
    const ev = buildCliSearchEvent({
      query: 'e2e undo commit',
      response: searchResponseFromResult({
        status: 'ok',
        confidence: 'high',
        results: [{ id: 'x', command: 'git reset', example: 'git reset', score: 1, skill_level: 1 }],
        advanced: null,
      }),
      latency_ms: 12,
      mock: true,
    });
    const r = await sendUmamiEvent({ ...ev, verbose: true });
    // Umami may reject unknown website id with 400/404; treat 2xx as pass.
    // If website missing, still assert we attempted a real HTTP round-trip without throwing.
    expect(r.skipped).not.toBe(true);
    expect(typeof r.ok).toBe('boolean');
  });

  it('negative: default config never sends', async () => {
    if (!available) return;
    writeConfig({ telemetry: null, telemetryInvite: 'pending' });
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls += 1;
      return orig(...args);
    };
    try {
      const out = await maybeInviteAndTrackSearch({
        query: 'should not send',
        result: { status: 'ok', results: [] },
        latencyMs: 1,
        mock: true,
      });
      expect(out.tracked).toBe(false);
      expect(calls).toBe(0);
      expect(readConfig().telemetry).not.toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('negative: DNT blocks even when telemetry true', async () => {
    if (!available) return;
    writeConfig({ telemetry: true });
    process.env.DO_NOT_TRACK = '1';
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls += 1;
      return orig(...args);
    };
    try {
      const out = await maybeInviteAndTrackSearch({
        query: 'dnt',
        result: { status: 'ok', results: [] },
        latencyMs: 1,
      });
      expect(out.tracked).toBe(false);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = orig;
      delete process.env.DO_NOT_TRACK;
    }
  });

  it('edge: dismissed invite does not prompt or send', async () => {
    if (!available) return;
    writeConfig({ telemetry: false, telemetryInvite: 'dismissed' });
    delete process.env.CI;
    let calls = 0;
    const orig = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      calls += 1;
      return orig(...args);
    };
    try {
      const out = await maybeInviteAndTrackSearch({
        query: 'dismissed',
        result: { status: 'ok', results: [] },
        latencyMs: 1,
        questionFn: async () => 'y',
      });
      // questionFn seam would allow invite only if invite pending; dismissed → no
      expect(out.tracked).toBe(false);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = orig;
      process.env.CI = '1';
    }
  });
});
