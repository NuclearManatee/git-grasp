#!/usr/bin/env bun
// @ts-nocheck
/**
 * CLI telemetry ↔ local Docker PostHog e2e.
 *
 * Requires:
 *   docker compose -f apps/web/docker-compose.posthog.yml --profile e2e up -d
 *   bun run evolve:seed-posthog   # or GIT_GRASP_POSTHOG_KEY already set
 *
 * Run: bun run test:telemetry-e2e
 * Skips cleanly when PostHog is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig } from '../../common/src/lib/config.js';
import { DEFAULT_POSTHOG_E2E_HOST } from '../../common/src/lib/telemetry/defaults.js';
import {
  maybeInviteAndTrackSearch,
  sendPosthogEvent,
  buildCliSearchEvent,
  searchResponseFromResult,
} from '../../common/src/lib/telemetry/index.js';
import { posthogReachable } from '../../common/src/evolve/posthogPull.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-posthog-e2e');
const POSTHOG_HOST = process.env.GIT_GRASP_POSTHOG_HOST || DEFAULT_POSTHOG_E2E_HOST;

function applySeedExports(stdout) {
  const text = String(stdout || '');
  const grab = (name) => {
    const m = text.match(new RegExp(`GIT_GRASP_${name}=([^\\s]+)`));
    return m ? m[1] : '';
  };
  const key = grab('POSTHOG_KEY');
  const projectId = grab('POSTHOG_PROJECT_ID');
  const pat = grab('POSTHOG_PERSONAL_API_KEY');
  const host = grab('POSTHOG_HOST');
  const apiHost = grab('POSTHOG_API_HOST');
  if (host) process.env.GIT_GRASP_POSTHOG_HOST = host;
  if (apiHost) process.env.GIT_GRASP_POSTHOG_API_HOST = apiHost;
  if (key) process.env.GIT_GRASP_POSTHOG_KEY = key;
  if (projectId) process.env.GIT_GRASP_POSTHOG_PROJECT_ID = projectId;
  if (pat) process.env.GIT_GRASP_POSTHOG_PERSONAL_API_KEY = pat;
}

describe('cli telemetry posthog e2e', () => {
  let available = false;
  const saved = {};

  beforeAll(async () => {
    for (const k of [
      'APPDATA',
      'XDG_CONFIG_HOME',
      'GIT_GRASP_POSTHOG_HOST',
      'GIT_GRASP_POSTHOG_API_HOST',
      'GIT_GRASP_POSTHOG_KEY',
      'GIT_GRASP_POSTHOG_PROJECT_ID',
      'GIT_GRASP_POSTHOG_PERSONAL_API_KEY',
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
    process.env.GIT_GRASP_POSTHOG_HOST = POSTHOG_HOST;
    process.env.GIT_GRASP_POSTHOG_API_HOST = POSTHOG_HOST;
    delete process.env.DO_NOT_TRACK;
    delete process.env.GIT_GRASP_TELEMETRY;
    process.env.CI = '1';

    available = await posthogReachable(POSTHOG_HOST);
    if (available && !process.env.GIT_GRASP_POSTHOG_KEY) {
      const seed = path.join(__dirname, '../../apps/pipeline/src/evolve/seed-posthog-e2e.ts');
      const r = spawnSync(process.execPath, [seed], {
        encoding: 'utf8',
        cwd: path.join(__dirname, '../..'),
        env: process.env,
      });
      applySeedExports(r.stdout);
    }
    available = available && Boolean(process.env.GIT_GRASP_POSTHOG_KEY);
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('positive: enabled search is accepted by PostHog capture', async () => {
    if (!available) {
      console.warn('skip: local PostHog not reachable at', POSTHOG_HOST);
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
    const r = await sendPosthogEvent({ ...ev, verbose: true });
    expect(r.skipped).not.toBe(true);
    expect(typeof r.ok).toBe('boolean');
  });

  it('negative: default config never sends', async () => {
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
});
