// @ts-nocheck

/**
 * Hard-off / enable gates. Default is off. Env never forces telemetry on.
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isHardOff(env = process.env) {
  if (env.DO_NOT_TRACK === '1') return true;
  if (env.GIT_GRASP_TELEMETRY === '0') return true;
  return false;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isNonInteractive(env = process.env) {
  if (env.CI === '1' || env.CI === 'true') return true;
  if (env.GIT_GRASP_BENCH === '1') return true;
  if (!process.stderr.isTTY) return true;
  if (!process.stdin.isTTY) return true;
  return false;
}

/**
 * Telemetry may send only when explicitly enabled and not hard-off.
 * @param {{ telemetry?: boolean|null }} cfg
 * @param {NodeJS.ProcessEnv} [env]
 */
export function isTelemetryEnabled(cfg, env = process.env) {
  if (isHardOff(env)) return false;
  return cfg?.telemetry === true;
}

/**
 * Soft invite only when off, invite pending, interactive, not hard-off.
 * @param {{ telemetry?: boolean|null, telemetryInvite?: string }} cfg
 * @param {NodeJS.ProcessEnv} [env]
 */
export function shouldPromptInvite(cfg, env = process.env) {
  if (isHardOff(env)) return false;
  if (isNonInteractive(env)) return false;
  if (cfg?.telemetry === true) return false;
  if (cfg?.telemetryInvite === 'dismissed') return false;
  return true;
}
