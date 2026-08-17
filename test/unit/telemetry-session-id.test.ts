// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeConfig, readConfig, defaultConfig } from '../../common/src/lib/config.js';
import {
  setTelemetryEnabled,
  mintTelemetrySessionId,
  buildCliSearchEvent,
  searchResponseFromResult,
} from '../../common/src/lib/telemetry/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-telemetry-session');

describe('telemetry session_id', () => {
  const saved = {};

  beforeEach(() => {
    for (const k of ['APPDATA', 'XDG_CONFIG_HOME']) {
      saved[k] = process.env[k];
    }
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') process.env.APPDATA = tmpRoot;
    else process.env.XDG_CONFIG_HOME = tmpRoot;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('defaultConfig has null telemetrySessionId', () => {
    expect(defaultConfig().telemetrySessionId).toBe(null);
  });

  it('mints session on enable and clears on disable', () => {
    const on = setTelemetryEnabled(true);
    expect(on.telemetry).toBe(true);
    expect(typeof on.telemetrySessionId).toBe('string');
    expect(on.telemetrySessionId.length).toBeGreaterThan(8);
    const sid = on.telemetrySessionId;

    const again = setTelemetryEnabled(true);
    expect(again.telemetrySessionId).toBe(sid);

    const off = setTelemetryEnabled(false);
    expect(off.telemetry).toBe(false);
    expect(off.telemetrySessionId).toBe(null);

    const reon = setTelemetryEnabled(true);
    expect(reon.telemetrySessionId).toBeTruthy();
    expect(reon.telemetrySessionId).not.toBe(sid);
  });

  it('cli_search includes session_id when provided', () => {
    const sid = mintTelemetrySessionId();
    const ev = buildCliSearchEvent({
      query: 'undo',
      response: searchResponseFromResult({ status: 'ok', confidence: 0.5, displayResults: [] }),
      latency_ms: 1,
      sessionId: sid,
    });
    expect(ev.data.session_id).toBe(sid);
  });

  it('persists telemetrySessionId via writeConfig', () => {
    writeConfig({ telemetrySessionId: 'abc-session' });
    expect(readConfig().telemetrySessionId).toBe('abc-session');
  });
});
