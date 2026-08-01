// @ts-nocheck
/**
 * Default-off regression: every case must leave fetch untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig } from '../../common/src/lib/config.js';
import { maybeInviteAndTrackSearch } from '../../common/src/lib/telemetry/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-telemetry-off');

const cases = [
  { name: 'fresh default', setup: () => {}, env: { CI: '1' } },
  {
    name: 'telemetry null dismissed',
    setup: () => writeConfig({ telemetry: null, telemetryInvite: 'dismissed' }),
    env: {},
  },
  {
    name: 'telemetry false',
    setup: () => writeConfig({ telemetry: false }),
    env: {},
  },
  {
    name: 'telemetry true but DNT',
    setup: () => writeConfig({ telemetry: true }),
    env: { DO_NOT_TRACK: '1' },
  },
  {
    name: 'telemetry true but GIT_GRASP_TELEMETRY=0',
    setup: () => writeConfig({ telemetry: true }),
    env: { GIT_GRASP_TELEMETRY: '0' },
  },
  {
    name: 'pending invite but CI',
    setup: () => writeConfig({ telemetry: null, telemetryInvite: 'pending' }),
    env: { CI: '1' },
  },
  {
    name: 'pending invite but BENCH',
    setup: () => writeConfig({ telemetry: null, telemetryInvite: 'pending' }),
    env: { GIT_GRASP_BENCH: '1' },
  },
];

describe('telemetry default-off regression', () => {
  const saved = {};

  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    for (const k of [
      'APPDATA',
      'XDG_CONFIG_HOME',
      'DO_NOT_TRACK',
      'GIT_GRASP_TELEMETRY',
      'CI',
      'GIT_GRASP_BENCH',
      'GIT_GRASP_UMAMI_HOST',
      'GIT_GRASP_UMAMI_WEBSITE_ID',
    ]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    if (process.platform === 'win32') process.env.APPDATA = tmpRoot;
    else process.env.XDG_CONFIG_HOME = tmpRoot;
    process.env.GIT_GRASP_UMAMI_HOST = 'http://127.0.0.1:3999';
    process.env.GIT_GRASP_UMAMI_WEBSITE_ID = 'test-website-id';
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  for (const c of cases) {
    it(`must not fetch: ${c.name}`, async () => {
      for (const [k, v] of Object.entries(c.env)) process.env[k] = v;
      c.setup();
      const fetchImpl = vi.fn(async () => ({ ok: true }));
      const out = await maybeInviteAndTrackSearch({
        query: 'must not track',
        result: { status: 'ok', results: [] },
        latencyMs: 1,
        fetchImpl,
        // Do not pass questionFn — that is a test seam that bypasses non-TTY/CI.
      });
      // When DNT with telemetry true, or CI with pending — never track
      expect(fetchImpl).toHaveBeenCalledTimes(0);
      expect(out.tracked).toBe(false);
      void readConfig();
    });
  }
});
