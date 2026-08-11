// @ts-nocheck
/** OBSERVE — optional CLI/web telemetry (Umami). Opt-in only. */
export {
  isHardOff,
  isTelemetryEnabled,
  shouldPromptInvite,
  telemetryStatus,
  setTelemetryEnabled,
  mintTelemetrySessionId,
  maybeInviteAndTrackSearch,
  sendUmamiEvent,
  buildCliSearchEvent,
  buildCliOptInEvent,
} from '../lib/telemetry/index.js';
