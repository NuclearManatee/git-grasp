import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  emojiEnabled,
  okLine,
  warnLine,
  cautionLine,
  errorLine,
  doctorPaint,
  EMOJI,
} from '../../common/src/ux/cliStyle.js';

describe('cliStyle emoji gate (V1 chalk-only)', () => {
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

  it('emojiEnabled is false by default', () => {
    expect(emojiEnabled({})).toBe(false);
    expect(emojiEnabled(process.env)).toBe(false);
  });

  it('GIT_GRASP_EMOJI=1 enables emoji', () => {
    expect(emojiEnabled({ GIT_GRASP_EMOJI: '1' })).toBe(true);
  });

  it('GIT_GRASP_NO_EMOJI wins over GIT_GRASP_EMOJI', () => {
    expect(emojiEnabled({ GIT_GRASP_EMOJI: '1', GIT_GRASP_NO_EMOJI: '1' })).toBe(false);
  });

  it('okLine has no emoji by default', () => {
    const s = okLine('Telemetry is enabled.', {});
    expect(s).not.toContain(EMOJI.ok);
    expect(s).toContain('Telemetry is enabled.');
  });

  it('okLine includes emoji when GIT_GRASP_EMOJI=1', () => {
    const s = okLine('Telemetry is enabled.', { GIT_GRASP_EMOJI: '1' });
    expect(s).toContain(EMOJI.ok);
  });

  it('doctorPaint keeps OK chalk path without emoji', () => {
    const s = doctorPaint('DB: OK (abc) schema v9', {});
    expect(s).not.toContain(EMOJI.ok);
    expect(s).toContain('OK');
  });

  it('doctorPaint uses emoji after label when enabled', () => {
    const s = doctorPaint('DB: OK (abc) schema v9', { GIT_GRASP_EMOJI: '1' });
    expect(s).toContain(`DB: ${EMOJI.ok}`);
    expect(s).not.toMatch(/^✅/);
  });

  it('warn/caution/error lines respect emoji gate', () => {
    expect(warnLine('hello', {})).not.toContain(EMOJI.warn);
    expect(warnLine('hello', { GIT_GRASP_EMOJI: '1' })).toContain(EMOJI.warn);
    expect(cautionLine('risky', {})).not.toContain(EMOJI.warn);
    expect(errorLine('boom', {})).not.toContain(EMOJI.error);
    expect(errorLine('boom', { GIT_GRASP_EMOJI: '1' })).toContain(EMOJI.error);
  });
});
