// @ts-nocheck
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getProvider } from './providers.js';

/** Soft RPM/TPM-style windows for SerialRateLimiter / WindowRateLimiter tests. */
export const WINDOW_LIMITS = Object.freeze({
  rpm: 30,
  rpd: 1000,
  tpm: 8000,
  tpd: 200_000,
});

export const DEEPSEEK_LIMITS = Object.freeze({
  /** Official account cap for deepseek-v4-flash. */
  concurrency: 2500,
  defaultConcurrency: 64,
});

function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function utcDayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Rough token estimate (~4 chars/token) for soft budgeting.
 */
export function estimateTokensFromText(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

export function estimateTokensFromMessages(messages = []) {
  let n = 0;
  for (const m of messages) {
    n += estimateTokensFromText(m?.content);
    n += 4;
  }
  return n + 16;
}

/**
 * Concurrency semaphore + optional soft RPM/TPM windows + retries.
 * Tuned for DeepSeek (official limit = concurrency only).
 */
export class ConcurrencyRateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.concurrency]
   * @param {{rpm?:number,rpd?:number,tpm?:number,tpd?:number}} [opts.limits] 0 = unlimited
   * @param {() => number} [opts.now]
   * @param {(ms: number) => Promise<void>} [opts.sleep]
   * @param {string|null} [opts.statePath]
   * @param {string|null} [opts.checkpointPath]
   * @param {number} [opts.maxRetries]
   * @param {number} [opts.minIntervalMs]
   */
  constructor({
    concurrency = DEEPSEEK_LIMITS.defaultConcurrency,
    limits = {},
    now = () => Date.now(),
    sleep = defaultSleep,
    statePath = null,
    checkpointPath = null,
    maxRetries = 6,
    minIntervalMs = 0,
  } = {}) {
    this.concurrency = Math.max(1, Number(concurrency) || 1);
    this.limits = {
      rpm: Number(limits.rpm) || 0,
      rpd: Number(limits.rpd) || 0,
      tpm: Number(limits.tpm) || 0,
      tpd: Number(limits.tpd) || 0,
    };
    this.now = now;
    this.sleep = sleep;
    this.statePath = statePath;
    this.checkpointPath = checkpointPath;
    this.maxRetries = maxRetries;
    this.minIntervalMs = minIntervalMs;
    this.lastAt = 0;
    this.active = 0;
    /** @type {Array<() => void>} */
    this.waiters = [];
    /** @type {{ t: number, tokens: number }[]} */
    this.minuteEvents = [];
    this.day = this.#loadDayState();
    this.checkpoint = this.#loadCheckpoint();
  }

  #loadDayState() {
    const empty = () => ({ day: utcDayKey(this.now()), requests: 0, tokens: 0 });
    if (!this.statePath || !existsSync(this.statePath)) return empty();
    try {
      const raw = JSON.parse(readFileSync(this.statePath, 'utf8'));
      if (raw.day !== utcDayKey(this.now())) return empty();
      return {
        day: raw.day,
        requests: Number(raw.requests) || 0,
        tokens: Number(raw.tokens) || 0,
      };
    } catch {
      return empty();
    }
  }

  #loadCheckpoint() {
    if (!this.checkpointPath || !existsSync(this.checkpointPath)) {
      return { cursor: 0, meta: {} };
    }
    try {
      return JSON.parse(readFileSync(this.checkpointPath, 'utf8'));
    } catch {
      return { cursor: 0, meta: {} };
    }
  }

  #persistDay() {
    if (!this.statePath) return;
    mkdirSync(path.dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, `${JSON.stringify(this.day, null, 2)}\n`);
  }

  #persistCheckpoint() {
    if (!this.checkpointPath) return;
    mkdirSync(path.dirname(this.checkpointPath), { recursive: true });
    writeFileSync(this.checkpointPath, `${JSON.stringify(this.checkpoint, null, 2)}\n`);
  }

  #rollDayIfNeeded() {
    const key = utcDayKey(this.now());
    if (this.day.day !== key) {
      this.day = { day: key, requests: 0, tokens: 0 };
      this.#persistDay();
    }
  }

  #pruneMinute(now) {
    const cutoff = now - 60_000;
    this.minuteEvents = this.minuteEvents.filter((e) => e.t > cutoff);
  }

  #minuteStats(now) {
    this.#pruneMinute(now);
    let requests = 0;
    let tokens = 0;
    for (const e of this.minuteEvents) {
      requests += 1;
      tokens += e.tokens;
    }
    return { requests, tokens };
  }

  /**
   * Wait for soft window limits (not concurrency). Infinity = daily soft cap.
   */
  timeUntilAllowed(estimatedTokens = 1) {
    this.#rollDayIfNeeded();
    const tokens = Math.max(1, Math.ceil(estimatedTokens));
    const now = this.now();

    if (this.limits.rpd > 0 && this.day.requests + 1 > this.limits.rpd) return Infinity;
    if (this.limits.tpd > 0 && this.day.tokens + tokens > this.limits.tpd) return Infinity;

    let wait = 0;
    const floor = this.minIntervalMs - (now - this.lastAt);
    if (floor > 0) wait = Math.max(wait, floor);

    const { requests, tokens: usedTok } = this.#minuteStats(now);
    const rpmHit = this.limits.rpm > 0 && requests + 1 > this.limits.rpm;
    const tpmHit = this.limits.tpm > 0 && usedTok + tokens > this.limits.tpm;
    if (rpmHit || tpmHit) {
      const oldest = this.minuteEvents[0];
      wait = Math.max(wait, oldest ? oldest.t + 60_000 - now + 1 : 1000);
    }
    return wait;
  }

  async #acquireSlot() {
    if (this.active < this.concurrency) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => {
      this.waiters.push(resolve);
    });
    this.active += 1;
  }

  #releaseSlot() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  getCursor() {
    return this.checkpoint.cursor ?? 0;
  }

  setCursor(n, meta = {}) {
    this.checkpoint.cursor = n;
    this.checkpoint.meta = { ...this.checkpoint.meta, ...meta };
    this.#persistCheckpoint();
  }

  getDayUsage() {
    this.#rollDayIfNeeded();
    return {
      ...this.day,
      active: this.active,
      concurrency: this.concurrency,
      limits: { ...this.limits },
    };
  }

  /**
   * Acquire concurrency slot, honor soft windows, run fn, record usage.
   */
  async schedule(fn, { estimatedTokens = 1 } = {}) {
    let attempt = 0;
    while (true) {
      const tokens = Math.max(1, Math.ceil(estimatedTokens));
      const wait = this.timeUntilAllowed(tokens);
      if (wait === Infinity) {
        const e = new Error('Daily soft quota exhausted (RPD/TPD); pausing');
        e.code = 'RATE_LIMIT_PAUSE';
        e.quota = this.getDayUsage();
        throw e;
      }
      if (wait > 0) await this.sleep(wait);

      await this.#acquireSlot();
      const started = this.now();
      try {
        const result = await fn();
        this.#recordSuccess(tokens, started);
        return result;
      } catch (err) {
        const status = err.status ?? err.statusCode;
        if (status === 429 || status === 503) {
          attempt += 1;
          if (attempt > this.maxRetries) {
            const e = new Error('Rate limited; pausing after max retries');
            e.code = 'RATE_LIMIT_PAUSE';
            e.cause = err;
            throw e;
          }
          const backoff = err.retryAfterMs
            ?? Math.min(30_000, 500 * 2 ** attempt + Math.floor(Math.random() * 200));
          await this.sleep(backoff);
          continue;
        }
        throw err;
      } finally {
        this.#releaseSlot();
      }
    }
  }

  /**
   * Run many tasks with the concurrency pool (each task still one API call).
   * @param {Array<() => Promise<any>>} tasks
   */
  async mapPool(tasks, { onResult } = {}) {
    const results = new Array(tasks.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, tasks.length) }, async () => {
      while (true) {
        const i = next;
        next += 1;
        if (i >= tasks.length) return;
        results[i] = await tasks[i]();
        if (onResult) onResult(i, results[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  #recordSuccess(tokens, t = this.now()) {
    this.#rollDayIfNeeded();
    this.minuteEvents.push({ t, tokens });
    this.lastAt = t;
    this.day.requests += 1;
    this.day.tokens += tokens;
    this.#persistDay();
  }

  /** Test helper */
  _recordForTest(tokens, t = this.now()) {
    this.#recordSuccess(tokens, t);
  }
}

/** Token-window limiter with concurrency=1 by default. */
export class WindowRateLimiter extends ConcurrencyRateLimiter {
  constructor(opts = {}) {
    const {
      concurrency = 1,
      minIntervalMs = 0,
      limits = WINDOW_LIMITS,
      ...rest
    } = opts;
    super({
      ...rest,
      concurrency,
      minIntervalMs,
      limits,
    });
  }
}

/** Prefer ConcurrencyRateLimiter for DeepSeek; this is serial + soft windows. */
export class SerialRateLimiter extends WindowRateLimiter {
  constructor(opts = {}) {
    super({
      ...opts,
      concurrency: 1,
      minIntervalMs: opts.minIntervalMs ?? 2000,
      limits: opts.limits ?? WINDOW_LIMITS,
    });
  }
}

/**
 * Factory: DeepSeek concurrency limiter (only provider).
 */
export function createRateLimiter({
  provider: providerOpt = null,
  statePath = null,
  checkpointPath = null,
  concurrency = null,
  minIntervalMs = null,
  maxRetries = null,
  limits = null,
} = {}) {
  const provider = getProvider(providerOpt);
  const envConc = Number(process.env.GIT_GRASP_LLM_CONCURRENCY);
  const conc = concurrency
    ?? (Number.isFinite(envConc) && envConc > 0 ? envConc : provider.defaultConcurrency);

  return new ConcurrencyRateLimiter({
    concurrency: Math.min(conc, provider.concurrencyLimit),
    limits: limits ?? provider.softLimits,
    statePath,
    checkpointPath,
    minIntervalMs: minIntervalMs ?? Number(process.env.GIT_GRASP_LLM_INTERVAL_MS || 0),
    maxRetries: maxRetries ?? 6,
  });
}
