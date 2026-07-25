import { describe, it, expect, vi } from 'vitest';
import { SerialRateLimiter } from '../../src/lib/rateLimit.js';

describe('SerialRateLimiter', () => {
  it('retries on 429 then succeeds', async () => {
    const lim = new SerialRateLimiter({ minIntervalMs: 1, maxRetries: 3 });
    let n = 0;
    const result = await lim.schedule(async () => {
      n += 1;
      if (n < 2) {
        const e = new Error('rate');
        e.status = 429;
        e.retryAfterMs = 1;
        throw e;
      }
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(n).toBe(2);
  });

  it('pauses after max retries', async () => {
    const lim = new SerialRateLimiter({ minIntervalMs: 1, maxRetries: 1 });
    await expect(lim.schedule(async () => {
      const e = new Error('rate');
      e.status = 429;
      e.retryAfterMs = 1;
      throw e;
    })).rejects.toMatchObject({ code: 'RATE_LIMIT_PAUSE' });
  });
});
