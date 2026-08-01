// @ts-nocheck
import { describe, it, expect } from 'vitest';
import {
  isHardOff,
  isNonInteractive,
  isTelemetryEnabled,
  shouldPromptInvite,
} from '../../common/src/lib/telemetry/gate.js';

describe('telemetry gate', () => {
  const baseCfg = { telemetry: null, telemetryInvite: 'pending' };

  it('default config is not enabled', () => {
    expect(isTelemetryEnabled(baseCfg, {})).toBe(false);
  });

  it('enabled only when telemetry true and not hard-off', () => {
    expect(isTelemetryEnabled({ telemetry: true }, {})).toBe(true);
    expect(isTelemetryEnabled({ telemetry: true }, { DO_NOT_TRACK: '1' })).toBe(false);
    expect(isTelemetryEnabled({ telemetry: true }, { GIT_GRASP_TELEMETRY: '0' })).toBe(false);
  });

  it('env never forces on', () => {
    expect(isTelemetryEnabled({ telemetry: null }, { GIT_GRASP_TELEMETRY: '1' })).toBe(false);
    expect(isHardOff({ GIT_GRASP_TELEMETRY: '1' })).toBe(false);
  });

  it('shouldPromptInvite matrix', () => {
    expect(shouldPromptInvite(baseCfg, {})).toBe(
      !isNonInteractive({}),
    );
    expect(shouldPromptInvite(baseCfg, { CI: '1' })).toBe(false);
    expect(shouldPromptInvite(baseCfg, { GIT_GRASP_BENCH: '1' })).toBe(false);
    expect(shouldPromptInvite(baseCfg, { DO_NOT_TRACK: '1' })).toBe(false);
    expect(
      shouldPromptInvite({ telemetry: true, telemetryInvite: 'pending' }, {}),
    ).toBe(false);
    expect(
      shouldPromptInvite({ telemetry: null, telemetryInvite: 'dismissed' }, {}),
    ).toBe(false);
    expect(
      shouldPromptInvite({ telemetry: false, telemetryInvite: 'pending' }, { CI: '1' }),
    ).toBe(false);
  });
});
