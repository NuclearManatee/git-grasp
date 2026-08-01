// @ts-nocheck
import { readConfig, writeConfig } from '../config.js';
import { isHardOff, isTelemetryEnabled, shouldPromptInvite } from './gate.js';
import { promptTelemetryInvite } from './invite.js';
import {
  buildCliOptInEvent,
  buildCliSearchEvent,
  searchResponseFromError,
  searchResponseFromResult,
} from './events.js';
import { sendUmamiEvent } from './send.js';

export {
  isHardOff,
  isNonInteractive,
  isTelemetryEnabled,
  shouldPromptInvite,
} from './gate.js';
export { sendUmamiEvent } from './send.js';
export {
  buildCliOptInEvent,
  buildCliSearchEvent,
  searchResponseFromError,
  searchResponseFromResult,
  resolveUmamiEndpoint,
} from './events.js';
export { promptTelemetryInvite } from './invite.js';
export { PRIVACY_URL, DEFAULT_UMAMI_HOST, DEFAULT_UMAMI_WEBSITE_ID } from './defaults.js';

/**
 * @returns {'on'|'off'} human status for doctor / telemetry status
 */
export function telemetryStatus(cfg = readConfig(), env = process.env) {
  if (isTelemetryEnabled(cfg, env)) return 'on';
  return 'off';
}

export function telemetryStatusDetail(cfg = readConfig(), env = process.env) {
  const enabled = isTelemetryEnabled(cfg, env);
  return {
    enabled,
    telemetry: cfg.telemetry ?? null,
    invite: cfg.telemetryInvite ?? 'pending',
    hardOff: !enabled && cfg.telemetry === true,
    label: enabled ? 'on' : 'off',
  };
}

export function setTelemetryEnabled(on) {
  if (on) {
    return writeConfig({ telemetry: true, telemetryInvite: 'dismissed' });
  }
  return writeConfig({ telemetry: false });
}

/**
 * Run soft invite if needed. Returns whether telemetry is enabled for this run.
 * @param {{ verbose?: boolean, questionFn?: Function, skipInvite?: boolean }} [opts]
 */
export async function maybeRunTelemetryInvite(opts = {}) {
  const cfg = readConfig();
  if (isTelemetryEnabled(cfg)) return true;
  // Test seam: providing questionFn implies an interactive invite path.
  const canInvite = opts.questionFn
    ? !isHardOff() && cfg?.telemetry !== true && cfg?.telemetryInvite !== 'dismissed'
    : shouldPromptInvite(cfg);
  if (opts.skipInvite || !canInvite) return false;

  const choice = await promptTelemetryInvite({
    questionFn: opts.questionFn,
  });

  if (choice === 'enable') {
    writeConfig({ telemetry: true, telemetryInvite: 'dismissed' });
    const ev = buildCliOptInEvent();
    await sendUmamiEvent({
      ...ev,
      verbose: Boolean(opts.verbose),
      fetchImpl: opts.fetchImpl,
    });
    return true;
  }
  if (choice === 'dismiss') {
    writeConfig({ telemetry: false, telemetryInvite: 'dismissed' });
    return false;
  }
  if (choice === 'disable') {
    writeConfig({ telemetry: false });
    return false;
  }
  return false;
}

/**
 * After a search completes (or fails), optionally invite then track.
 * @param {object} args
 * @param {string} args.query
 * @param {object|null} args.result
 * @param {Error|null} [args.error]
 * @param {number} args.latencyMs
 * @param {boolean} [args.mock]
 * @param {boolean} [args.verbose]
 * @param {Function} [args.questionFn] — test seam for invite
 * @param {typeof fetch} [args.fetchImpl]
 */
export async function maybeInviteAndTrackSearch({
  query,
  result = null,
  error = null,
  latencyMs,
  mock = false,
  verbose = false,
  questionFn,
  fetchImpl,
} = {}) {
  let enabled = isTelemetryEnabled(readConfig());
  if (!enabled) {
    enabled = await maybeRunTelemetryInvite({ verbose, questionFn, fetchImpl });
  }
  if (!enabled) return { tracked: false };

  const response = error
    ? searchResponseFromError(error)
    : searchResponseFromResult(result);
  const ev = buildCliSearchEvent({
    query,
    response,
    latency_ms: latencyMs,
    mock,
  });
  const sendResult = await sendUmamiEvent({
    ...ev,
    verbose,
    fetchImpl,
  });
  return { tracked: Boolean(sendResult.ok), sendResult };
}
