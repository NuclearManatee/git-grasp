import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Serial rate limiter with exponential backoff and checkpoint support.
 */
export class SerialRateLimiter {
  constructor({
    minIntervalMs = 1200,
    maxRetries = 8,
    checkpointPath = null,
  } = {}) {
    this.minIntervalMs = minIntervalMs;
    this.maxRetries = maxRetries;
    this.checkpointPath = checkpointPath;
    this.lastAt = 0;
    this.checkpoint = checkpointPath && existsSync(checkpointPath)
      ? JSON.parse(readFileSync(checkpointPath, 'utf8'))
      : { cursor: 0, meta: {} };
  }

  getCursor() {
    return this.checkpoint.cursor ?? 0;
  }

  setCursor(n, meta = {}) {
    this.checkpoint.cursor = n;
    this.checkpoint.meta = { ...this.checkpoint.meta, ...meta };
    this.save();
  }

  save() {
    if (!this.checkpointPath) return;
    mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
    writeFileSync(this.checkpointPath, `${JSON.stringify(this.checkpoint, null, 2)}\n`);
  }

  async waitTurn() {
    const now = Date.now();
    const wait = this.minIntervalMs - (now - this.lastAt);
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }

  /**
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  async schedule(fn) {
    let attempt = 0;
    while (true) {
      await this.waitTurn();
      try {
        return await fn();
      } catch (err) {
        const status = err.status ?? err.statusCode;
        const retryAfter = err.retryAfterMs;
        if (status === 429 || status === 503) {
          attempt += 1;
          if (attempt > this.maxRetries) {
            const e = new Error('Rate limited; pausing');
            e.code = 'RATE_LIMIT_PAUSE';
            e.cause = err;
            throw e;
          }
          const backoff = retryAfter
            ?? Math.min(60_000, 1000 * 2 ** attempt + Math.random() * 500);
          await sleep(backoff);
          continue;
        }
        throw err;
      }
    }
  }
}
