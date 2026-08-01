// @ts-nocheck
import { TELEMETRY_TIMEOUT_MS } from './defaults.js';
import { resolveUmamiEndpoint } from './events.js';

/**
 * @param {{ name: string, data?: Record<string, unknown>, verbose?: boolean, fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
export async function sendUmamiEvent({
  name,
  data = {},
  verbose = false,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const { host, websiteId } = resolveUmamiEndpoint(env);
  if (!host || !websiteId) {
    const reason = 'umami endpoint or website id unset';
    if (verbose) console.error(`telemetry: send failed: ${reason}`);
    return { ok: false, skipped: true, reason };
  }

  const url = `${host}/api/send`;
  const body = {
    type: 'event',
    payload: {
      website: websiteId,
      hostname: 'cli.git-grasp',
      language: env.LANG || 'en-US',
      url: '/cli',
      name,
      data,
    },
  };

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac
    ? setTimeout(() => ac.abort(), TELEMETRY_TIMEOUT_MS)
    : null;

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `git-grasp-cli/${data.app_version || '0.1.0'}`,
      },
      body: JSON.stringify(body),
      signal: ac?.signal,
    });
    if (!res.ok) {
      const reason = `http ${res.status}`;
      if (verbose) console.error(`telemetry: send failed: ${reason}`);
      return { ok: false, reason };
    }
    return { ok: true };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
    if (verbose) console.error(`telemetry: send failed: ${reason}`);
    return { ok: false, reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
