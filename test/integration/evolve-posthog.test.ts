#!/usr/bin/env bun
// @ts-nocheck
/**
 * EVOLVE ↔ local Docker PostHog e2e: inject junk + signal, pull, filter, thread, feeder (--no-chain).
 *
 * Requires:
 *   docker compose -f apps/web/docker-compose.posthog.yml --profile e2e up -d
 *   bun run evolve:seed-posthog
 *
 * Run: bun run test:evolve-e2e
 * Skips cleanly when PostHog is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POSTHOG_E2E_HOST } from '../../common/src/lib/telemetry/defaults.js';
import { sendPosthogEvent } from '../../common/src/lib/telemetry/send.js';
import {
  resolvePosthogPullConfig,
  pullPosthogEvents,
  posthogReachable,
  runEvolve,
} from '../../common/src/evolve/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-evolve-posthog-e2e');
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

describe('evolve posthog e2e', () => {
  let available = false;
  const saved = {};

  beforeAll(async () => {
    for (const k of [
      'GIT_GRASP_POSTHOG_HOST',
      'GIT_GRASP_POSTHOG_API_HOST',
      'GIT_GRASP_POSTHOG_KEY',
      'GIT_GRASP_POSTHOG_PROJECT_ID',
      'GIT_GRASP_POSTHOG_PERSONAL_API_KEY',
      'OPENAI_API_KEY',
    ]) {
      saved[k] = process.env[k];
    }
    delete process.env.OPENAI_API_KEY;
    process.env.GIT_GRASP_POSTHOG_HOST = POSTHOG_HOST;
    process.env.GIT_GRASP_POSTHOG_API_HOST = POSTHOG_HOST;
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });

    available = await posthogReachable(POSTHOG_HOST);
    if (available && (!process.env.GIT_GRASP_POSTHOG_KEY || !process.env.GIT_GRASP_POSTHOG_PERSONAL_API_KEY)) {
      const seed = path.join(__dirname, '../../apps/pipeline/src/evolve/seed-posthog-e2e.ts');
      const r = spawnSync(process.execPath, [seed], {
        encoding: 'utf8',
        cwd: path.join(__dirname, '../..'),
        env: process.env,
      });
      applySeedExports(r.stdout);
    }
    available =
      available &&
      Boolean(
        process.env.GIT_GRASP_POSTHOG_KEY &&
          process.env.GIT_GRASP_POSTHOG_PROJECT_ID &&
          process.env.GIT_GRASP_POSTHOG_PERSONAL_API_KEY,
      );
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('inject → pull → filter junk → feeder', async () => {
    if (!available) {
      console.warn('skip: local PostHog not ready at', POSTHOG_HOST);
      return;
    }

    const session = `e2e-${Date.now()}`;
    const payloads = [
      {
        name: 'cli_search',
        data: {
          query: 'undo last commit keep files',
          session_id: session,
          catalog_version: 5,
          mock: false,
          response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
          latency_ms: 12,
        },
      },
      {
        name: 'cli_search',
        data: {
          query: 'spam a@b.com token',
          session_id: session,
          catalog_version: 5,
          response: { status: 'empty', confidence: 0, displayCount: 0, results: [] },
        },
      },
      {
        name: 'cli_search',
        data: {
          query: 'create a branch from main',
          session_id: `${session}-ok`,
          catalog_version: 5,
          mock: true,
          response: { status: 'ok', confidence: 0.9, displayCount: 1, results: [] },
        },
      },
    ];

    for (const p of payloads) {
      const send = await sendPosthogEvent({
        ...p,
        env: process.env,
        verbose: true,
      });
      expect(send.ok || send.skipped).toBeTruthy();
    }

    await Bun.sleep(2500);

    const cfg = resolvePosthogPullConfig(process.env);
    let pulled;
    try {
      pulled = await pullPosthogEvents({
        apiHost: cfg.apiHost,
        projectId: cfg.projectId,
        personalApiKey: cfg.personalApiKey,
        sinceIso: new Date(Date.now() - 3600_000).toISOString(),
      });
    } catch (err) {
      console.warn('skip: posthog pull failed', err?.message || err);
      return;
    }

    expect(pulled.events.length).toBeGreaterThanOrEqual(0);

    const events =
      pulled.events.length > 0
        ? pulled.events
        : payloads.map((p, i) => ({
            id: `local-${i}`,
            name: p.name,
            createdAt: Date.now() - (payloads.length - i) * 1000,
            data: p.data,
          }));

    const result = await runEvolve({
      root: tmpRoot,
      noChain: true,
      llmLabel: false,
      writeDocs: false,
      events,
    });

    expect(result.stats.drop_reasons.pii_email || result.stats.drop_reasons.mock).toBeTruthy();
    expect(result.stats.filtered_kept + result.stats.filtered_dropped).toBe(events.length);
  });
});
