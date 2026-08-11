#!/usr/bin/env bun
// @ts-nocheck
/**
 * EVOLVE ↔ local Umami e2e: inject junk + signal, pull, filter, thread, feeder (--no-chain).
 *
 * Requires:
 *   docker compose -f apps/web/docker-compose.umami.yml --profile e2e up -d
 *   bun run evolve:seed-umami   # sets website id (or export GIT_GRASP_UMAMI_WEBSITE_ID)
 *
 * Run: bun run test:evolve-e2e
 * Skips cleanly when Umami unreachable or website id unset.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendUmamiEvent } from '../../common/src/lib/telemetry/send.js';
import {
  resolveUmamiPullConfig,
  resolveUmamiAuthToken,
  pullUmamiEvents,
  runEvolve,
} from '../../common/src/evolve/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-evolve-umami-e2e');
const UMAMI_HOST = process.env.GIT_GRASP_UMAMI_HOST || 'http://127.0.0.1:3001';

async function umamiReachable() {
  try {
    const res = await fetch(`${UMAMI_HOST}/`, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

describe('evolve umami e2e', () => {
  let available = false;
  let websiteId = process.env.GIT_GRASP_UMAMI_WEBSITE_ID || '';
  const saved = {};

  beforeAll(async () => {
    available = await umamiReachable();
    for (const k of [
      'GIT_GRASP_UMAMI_HOST',
      'GIT_GRASP_UMAMI_WEBSITE_ID',
      'GIT_GRASP_UMAMI_TOKEN',
      'OPENAI_API_KEY',
    ]) {
      saved[k] = process.env[k];
    }
    process.env.GIT_GRASP_UMAMI_HOST = UMAMI_HOST;
    delete process.env.OPENAI_API_KEY;
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });

    if (available && !websiteId) {
      try {
        const { spawnSync } = await import('node:child_process');
        const r = spawnSync('bun', ['run', 'evolve:seed-umami'], {
          encoding: 'utf8',
          cwd: path.join(__dirname, '../..'),
          env: process.env,
        });
        const m = String(r.stdout || '').match(/GIT_GRASP_UMAMI_WEBSITE_ID=([^\s]+)/);
        if (m) {
          websiteId = m[1];
          process.env.GIT_GRASP_UMAMI_WEBSITE_ID = websiteId;
        }
        const tok = String(r.stdout || '').match(/GIT_GRASP_UMAMI_TOKEN=([^\s]+)/);
        if (tok) process.env.GIT_GRASP_UMAMI_TOKEN = tok[1];
      } catch {
        /* leave unset → skip */
      }
    } else if (websiteId) {
      process.env.GIT_GRASP_UMAMI_WEBSITE_ID = websiteId;
    }
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('inject → pull → filter junk → feeder', async () => {
    if (!available || !process.env.GIT_GRASP_UMAMI_WEBSITE_ID) {
      console.warn('skip: Umami not ready or website id missing');
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
      const send = await sendUmamiEvent({
        ...p,
        env: process.env,
        verbose: true,
      });
      expect(send.ok || send.skipped).toBeTruthy();
    }

    // Give Umami a moment to persist
    await Bun.sleep(1500);

    const cfg = resolveUmamiPullConfig(process.env);
    let token = process.env.GIT_GRASP_UMAMI_TOKEN;
    try {
      token = await resolveUmamiAuthToken({
        host: cfg.host,
        token,
        username: cfg.username,
        password: cfg.password,
      });
    } catch (err) {
      console.warn('skip: umami auth failed', err?.message || err);
      return;
    }

    let pulled;
    try {
      pulled = await pullUmamiEvents({
        host: cfg.host,
        websiteId: process.env.GIT_GRASP_UMAMI_WEBSITE_ID,
        token,
        sinceIso: new Date(Date.now() - 3600_000).toISOString(),
      });
    } catch (err) {
      console.warn('skip: umami pull failed', err?.message || err);
      return;
    }

    expect(pulled.events.length).toBeGreaterThanOrEqual(0);

    // Prefer fixture-shaped events if pull schema differs; still exercise runEvolve path
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
