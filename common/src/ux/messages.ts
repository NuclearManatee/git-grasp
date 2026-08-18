// @ts-nocheck
/**
 * Shared MSG.* formatters — keep in sync with apps/cli/README.md#ux
 */
import { PRIVACY_URL } from '../lib/telemetry/defaults.js';
import { skillName } from '../lib/skills.js';
import {
  okLine,
  infoLine,
  warnLine,
  statusLine,
  withLink,
  style,
} from './cliStyle.js';

/** MSG.telemetry.on */
export function msgTelemetryOn(env) {
  return withLink(
    okLine(
      'Telemetry is enabled. Your searches will be used to improve the product for everyone. See',
      env,
    ),
    PRIVACY_URL,
  );
}

/** MSG.telemetry.off */
export function msgTelemetryOff(env) {
  return infoLine('Telemetry is disabled. No search analytics will be sent.', env);
}

/** MSG.telemetry.status.head */
export function msgTelemetryStatusHead(on, env) {
  return statusLine('Telemetry', Boolean(on), env);
}

/**
 * Full CLI telemetry status block (head + muted detail lines).
 * @param {{ label: string, telemetry: unknown, invite: string }} detail
 */
export function msgTelemetryStatusBlock(detail, env) {
  const on = detail.label === 'on';
  return [
    msgTelemetryStatusHead(on, env),
    style.muted(`  config.telemetry=${JSON.stringify(detail.telemetry)}`),
    style.muted(`  invite=${detail.invite}`),
    style.muted('  privacy=') + style.link(PRIVACY_URL),
  ].join('\n');
}

/**
 * Playground: telemetry cannot be disabled mid-session (privacy §5).
 * MSG-adjacent withdrawal tip.
 */
export function msgTelemetryOffPlayground(env) {
  return infoLine(
    'Playground telemetry stays on while you use this session. Leave the playground, or install the CLI (telemetry off by default).',
    env,
  );
}

/** Playground telemetry status (always on after Start). */
export function msgTelemetryStatusPlayground(env) {
  return [
    msgTelemetryStatusHead(true, env),
    style.muted('  source=playground (Start = consent)'),
    style.muted('  privacy=') + style.link(PRIVACY_URL),
  ].join('\n');
}

/** MSG.skill.cleared */
export function msgSkillCleared(env) {
  return infoLine('Preferred skill cleared. (Does not change search results yet.)', env);
}

/** MSG.skill.set */
export function msgSkillSet(level, env) {
  const name = skillName(level);
  return infoLine(
    `Preferred skill set to ${name} (${level}). (Does not change search results yet.)`,
    env,
  );
}

/** MSG.init.warm */
export function msgInitWarm(env) {
  return infoLine('Downloading/warming the embedding model…', env);
}

/** MSG.init.warmMock */
export function msgInitWarmMock(env) {
  return infoLine('Warming embeddings (mock)…', env);
}

/** MSG.init.ready */
export function msgInitReady(env) {
  return okLine('Ready. Search will use the local model and catalog.', env);
}

/** MSG.search.copy.ok — inventory: muted */
export function msgSearchCopyOk(env) {
  return infoLine('Copied command to clipboard.', env);
}

/** MSG.search.copy.fail */
export function msgSearchCopyFail(env) {
  return warnLine('Clipboard unavailable — command is printed above.', env);
}

/** MSG.update.on */
export function msgUpdateOn(env) {
  return okLine(
    'Update check is enabled. git-grasp will occasionally check npm for a newer release.',
    env,
  );
}

/** MSG.update.off */
export function msgUpdateOff(env) {
  return infoLine('Update check is disabled. No version checks will be sent.', env);
}
