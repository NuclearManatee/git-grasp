// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConcurrencyRateLimiter,
  WindowRateLimiter,
  WINDOW_LIMITS,
  DEEPSEEK_LIMITS,
  estimateTokensFromText,
  estimateTokensFromMessages,
  SerialRateLimiter,
  createRateLimiter,
} from '../../common/src/lib/rateLimit.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('estimateTokens', () => {
  it('happy: scales with length', () => {
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('a'.repeat(40))).toBe(10);
  });

  it('edge: empty ÔåÆ 0', () => {
    expect(estimateTokensFromText('')).toBe(0);
    expect(estimateTokensFromText(null)).toBe(0);
  });

  it('messages include overhead', () => {
    const n = estimateTokensFromMessages([{ role: 'user', content: 'hi' }]);
    expect(n).toBeGreaterThan(estimateTokensFromText('hi'));
  });
});

describe('ConcurrencyRateLimiter (DeepSeek-style)', () => {
  let now;
  let slept;
  let lim;
  let tmp;

  beforeEach(() => {
    now = 1_700_000_000_000;
    slept = [];
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gh-rl-'));
    lim = new ConcurrencyRateLimiter({
      concurrency: 2,
      now: () => now,
      sleep: async (ms) => { slept.push(ms); now += ms; },
      statePath: path.join(tmp, 'day.json'),
      checkpointPath: path.join(tmp, 'cp.json'),
      minIntervalMs: 0,
      maxRetries: 3,
      limits: { rpm: 0, rpd: 0, tpm: 0, tpd: 0 },
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('happy: runs under concurrency', async () => {
    const out = await lim.schedule(async () => 'ok', { estimatedTokens: 10 });
    expect(out).toBe('ok');
    expect(lim.getDayUsage().requests).toBe(1);
  });

  it('positive: parallel mapPool respects concurrency', async () => {
    const lim2 = new ConcurrencyRateLimiter({
      concurrency: 2,
      now: () => now,
      sleep: async (ms) => { now += ms; },
      limits: {},
    });
    let inflight = 0;
    let peakIn = 0;
    const results = await lim2.mapPool(
      Array.from({ length: 8 }, (_, i) => async () => {
        return lim2.schedule(async () => {
          inflight += 1;
          peakIn = Math.max(peakIn, inflight);
          await lim2.sleep(1);
          inflight -= 1;
          return i * 2;
        });
      }),
    );
    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(peakIn).toBeLessThanOrEqual(2);
  });

  it('negative: soft RPD pause', async () => {
    lim = new ConcurrencyRateLimiter({
      concurrency: 1,
      now: () => now,
      sleep: async (ms) => { slept.push(ms); now += ms; },
      limits: { rpd: 1, rpm: 0, tpm: 0, tpd: 0 },
    });
    await lim.schedule(async () => 1, { estimatedTokens: 1 });
    await expect(lim.schedule(async () => 2, { estimatedTokens: 1 }))
      .rejects.toMatchObject({ code: 'RATE_LIMIT_PAUSE' });
  });

  it('fault: retries 429 then succeeds', async () => {
    let n = 0;
    const out = await lim.schedule(async () => {
      n += 1;
      if (n < 3) {
        const e = new Error('busy');
        e.status = 429;
        e.retryAfterMs = 10;
        throw e;
      }
      return 'done';
    });
    expect(out).toBe('done');
    expect(n).toBe(3);
    expect(slept.some((ms) => ms >= 10)).toBe(true);
  });

  it('fault: max retries ÔåÆ RATE_LIMIT_PAUSE', async () => {
    await expect(lim.schedule(async () => {
      const e = new Error('nope');
      e.status = 429;
      throw e;
    })).rejects.toMatchObject({ code: 'RATE_LIMIT_PAUSE' });
  });

  it('edge: checkpoint cursor persists', () => {
    lim.setCursor(7, { foo: 1 });
    const lim2 = new ConcurrencyRateLimiter({
      now: () => now,
      sleep: async () => {},
      checkpointPath: path.join(tmp, 'cp.json'),
      statePath: path.join(tmp, 'day.json'),
    });
    expect(lim2.getCursor()).toBe(7);
  });

  it('edge: DEEPSEEK defaults', () => {
    expect(DEEPSEEK_LIMITS.concurrency).toBe(2500);
    expect(DEEPSEEK_LIMITS.defaultConcurrency).toBeGreaterThanOrEqual(1);
  });
});

describe('WindowRateLimiter (soft windows)', () => {
  let now;
  let slept;
  let lim;
  let tmp;

  beforeEach(() => {
    now = 1_700_000_000_000;
    slept = [];
    tmp = mkdtempSync(path.join(os.tmpdir(), 'gh-rl-g-'));
    lim = new WindowRateLimiter({
      now: () => now,
      sleep: async (ms) => { slept.push(ms); now += ms; },
      statePath: path.join(tmp, 'day.json'),
      checkpointPath: path.join(tmp, 'cp.json'),
      minIntervalMs: 0,
      maxRetries: 3,
      limits: { rpm: 3, rpd: 10, tpm: 100, tpd: 500 },
    });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('happy path schedules', async () => {
    await lim.schedule(async () => 'x', { estimatedTokens: 10 });
    expect(lim.getDayUsage().tokens).toBe(10);
  });

  it('waits when RPM exceeded', async () => {
    for (let i = 0; i < 3; i += 1) lim._recordForTest(1, now);
    const wait = lim.timeUntilAllowed(1);
    expect(wait).toBeGreaterThan(0);
  });

  it('TPD exhaustion', async () => {
    lim = new WindowRateLimiter({
      now: () => now,
      sleep: async (ms) => { slept.push(ms); now += ms; },
      limits: { rpm: 100, rpd: 100, tpm: 10_000, tpd: 50 },
    });
    lim._recordForTest(50, now);
    await expect(lim.schedule(async () => 1, { estimatedTokens: 1 }))
      .rejects.toMatchObject({ code: 'RATE_LIMIT_PAUSE' });
  });

  it('SerialRateLimiter still works', async () => {
    const s = new SerialRateLimiter({
      now: () => now,
      sleep: async (ms) => { now += ms; },
      minIntervalMs: 100,
      limits: WINDOW_LIMITS,
    });
    await s.schedule(async () => 1);
    expect(s.getDayUsage().requests).toBe(1);
  });
});

describe('createRateLimiter', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('deepseek ÔåÆ concurrency limiter', () => {
    process.env.GIT_GRASP_LLM_PROVIDER = 'deepseek';
    process.env.GIT_GRASP_LLM_CONCURRENCY = '8';
    const lim = createRateLimiter({});
    expect(lim).toBeInstanceOf(ConcurrencyRateLimiter);
    expect(lim.concurrency).toBe(8);
  });

  it('unknown provider throws', () => {
    process.env.GIT_GRASP_LLM_PROVIDER = 'groq';
    expect(() => createRateLimiter({})).toThrow(/Unknown LLM provider/);
  });
});
