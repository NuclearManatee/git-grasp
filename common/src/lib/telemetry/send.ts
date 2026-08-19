// @ts-nocheck
import { TELEMETRY_TIMEOUT_MS } from './defaults.js';
import { resolvePosthogEndpoint } from './events.js';
import { isHardOff } from './gate.js';
import { piiOrJunkReason } from './scrub.js';

/**
 * @param {{ name: string, data?: Record<string, unknown>, verbose?: boolean, fetchImpl?: typeof fetch, env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<{ ok: boolean, skipped?: boolean, reason?: string }>}
 */
export async function sendPosthogEvent({
  name,
  data = {},
  verbose = false,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  if (isHardOff(env)) {
    return { ok: false, skipped: true, reason: 'hard-off' };
  }

  if (data && Object.prototype.hasOwnProperty.call(data, 'query')) {
    const scrub = piiOrJunkReason(data.query);
    if (scrub) {
      if (verbose) console.error(`telemetry: send skipped: scrub:${scrub}`);
      return { ok: false, skipped: true, reason: `scrub:${scrub}` };
    }
  }

  const { host, projectApiKey } = resolvePosthogEndpoint(env);
  if (!host || !projectApiKey) {
    const reason = 'posthog host or project api key unset';
    if (verbose) console.error(`telemetry: send failed: ${reason}`);
    return { ok: false, skipped: true, reason };
  }

  const distinctId =
    (typeof data.session_id === 'string' && data.session_id) || 'cli-anonymous';
  const payload = {
    api_key: projectApiKey,
    event: name,
    distinct_id: distinctId,
    properties: {
      ...data,
      $lib: (typeof data.$lib === 'string' && data.$lib) || 'git-grasp-cli',
      $lib_version: data.app_version || '0.1.0',
      $process_person_profile: false,
      $geoip_disable: true,
    },
  };
  // Cloud ingest uses /i/v0/e/. Self-hosted Django still serves /e/ and /capture/.
  const paths = host.includes('.i.posthog.com')
    ? ['/i/v0/e/']
    : ['/i/v0/e/', '/e/', '/capture/'];

  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), TELEMETRY_TIMEOUT_MS) : null;

  try {
    let lastReason = 'http unknown';
    for (const path of paths) {
      const res = await fetchImpl(`${host}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': `git-grasp-cli/${data.app_version || '0.1.0'}`,
        },
        body: JSON.stringify(payload),
        signal: ac?.signal,
      });
      if (res.ok) return { ok: true };
      lastReason = `http ${res.status}`;
      if (res.status !== 404 && res.status !== 405) break;
    }
    if (verbose) console.error(`telemetry: send failed: ${lastReason}`);
    return { ok: false, reason: lastReason };
  } catch (err) {
    const reason = err?.name === 'AbortError' ? 'timeout' : String(err?.message || err);
    if (verbose) console.error(`telemetry: send failed: ${reason}`);
    return { ok: false, reason };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
