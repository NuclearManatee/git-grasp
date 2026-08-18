// @ts-nocheck
/** OBSERVE — optional CLI/web telemetry (PostHog). Opt-in only. */
export {
  isHardOff,
  isTelemetryEnabled,
  shouldPromptInvite,
  telemetryStatus,
  setTelemetryEnabled,
  mintTelemetrySessionId,
  maybeInviteAndTrackSearch,
  sendPosthogEvent,
  buildCliSearchEvent,
  buildCliOptInEvent,
} from '../lib/telemetry/index.js';
