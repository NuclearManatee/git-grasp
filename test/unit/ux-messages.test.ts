import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { stripAnsi } from '../../common/src/lib/ansi.js';
import { PRIVACY_URL } from '../../common/src/lib/telemetry/defaults.js';
import {
  msgTelemetryOn,
  msgTelemetryOff,
  msgTelemetryStatusHead,
  msgTelemetryStatusBlock,
  msgTelemetryOffPlayground,
  msgTelemetryStatusPlayground,
  msgSkillCleared,
  msgSkillSet,
  msgInitWarm,
  msgInitWarmMock,
  msgInitReady,
  msgSearchCopyOk,
  msgSearchCopyFail,
  msgUpdateOn,
  msgUpdateOff,
} from '../../common/src/ux/messages.js';

function plain(s) {
  return stripAnsi(s);
}

describe('ux messages (MSG inventory)', () => {
  const keys = ['GIT_GRASP_EMOJI', 'GIT_GRASP_NO_EMOJI'];
  const saved = {};

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('MSG.telemetry.on matches cli-ux-review telemetry-on', () => {
    expect(plain(msgTelemetryOn({}))).toBe(
      `Telemetry is enabled. Your searches will be used to improve the product for everyone. See ${PRIVACY_URL}`,
    );
  });

  it('MSG.telemetry.on with emoji matches telemetry-on-emoji', () => {
    expect(plain(msgTelemetryOn({ GIT_GRASP_EMOJI: '1' }))).toBe(
      `✅ Telemetry is enabled. Your searches will be used to improve the product for everyone. See ${PRIVACY_URL}`,
    );
  });

  it('MSG.telemetry.off', () => {
    expect(plain(msgTelemetryOff({}))).toBe(
      'Telemetry is disabled. No search analytics will be sent.',
    );
  });

  it('MSG.telemetry.status.head', () => {
    expect(plain(msgTelemetryStatusHead(true, {}))).toBe('Telemetry: on');
    expect(plain(msgTelemetryStatusHead(false, {}))).toBe('Telemetry: off');
  });

  it('MSG.telemetry.status block includes privacy link', () => {
    const block = plain(
      msgTelemetryStatusBlock(
        { label: 'on', telemetry: true, invite: 'dismissed' },
        {},
      ),
    );
    expect(block).toContain('Telemetry: on');
    expect(block).toContain('config.telemetry=true');
    expect(block).toContain('invite=dismissed');
    expect(block).toContain(`privacy=${PRIVACY_URL}`);
  });

  it('playground telemetry status is always on', () => {
    const block = plain(msgTelemetryStatusPlayground({}));
    expect(block).toContain('Telemetry: on');
    expect(block).toContain('source=playground');
    expect(block).toContain(PRIVACY_URL);
  });

  it('playground telemetry off tip does not claim disabled', () => {
    const text = plain(msgTelemetryOffPlayground({}));
    expect(text.toLowerCase()).toContain('playground');
    expect(text.toLowerCase()).not.toContain('telemetry is disabled');
  });

  it('MSG.skill parked copy', () => {
    expect(plain(msgSkillCleared({}))).toBe(
      'Preferred skill cleared. (Does not change search results yet.)',
    );
    expect(plain(msgSkillSet(2, {}))).toBe(
      'Preferred skill set to beginner (2). (Does not change search results yet.)',
    );
  });

  it('MSG.init warm/ready', () => {
    expect(plain(msgInitWarm({}))).toBe('Downloading/warming the embedding model…');
    expect(plain(msgInitWarmMock({}))).toBe('Warming embeddings (mock)…');
    expect(plain(msgInitReady({}))).toBe(
      'Ready. Search will use the local model and catalog.',
    );
  });

  it('MSG.search.copy ok/fail', () => {
    expect(plain(msgSearchCopyOk({}))).toBe('Copied command to clipboard.');
    expect(plain(msgSearchCopyFail({}))).toBe(
      'Clipboard unavailable — command is printed above.',
    );
  });

  it('MSG.update on/off', () => {
    expect(plain(msgUpdateOn({}))).toContain('Update check is enabled.');
    expect(plain(msgUpdateOff({}))).toContain('Update check is disabled.');
  });
});
