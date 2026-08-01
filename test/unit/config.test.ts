// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeConfig,
  readConfig,
  defaultConfig,
  CONFIG_SCHEMA_VERSION,
} from '../../packages/core/src/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-config-telemetry');

describe('config telemetry schema', () => {
  const prevAppData = process.env.APPDATA;
  const prevXdg = process.env.XDG_CONFIG_HOME;

  beforeEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') {
      process.env.APPDATA = tmpRoot;
    } else {
      process.env.XDG_CONFIG_HOME = tmpRoot;
    }
  });

  afterEach(() => {
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('defaults telemetry off and invite pending', () => {
    const d = defaultConfig();
    expect(d.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(d.telemetry).toBe(null);
    expect(d.telemetryInvite).toBe('pending');
    expect(readConfig().telemetry).toBe(null);
  });

  it('writes and reads skill level', () => {
    writeConfig({ skillLevel: 3 });
    expect(readConfig().skillLevel).toBe(3);
    writeConfig({ skillLevel: null });
    expect(readConfig().skillLevel).toBe(null);
  });

  it('merges skillLevel without wiping telemetry', () => {
    writeConfig({ telemetry: true, telemetryInvite: 'dismissed' });
    writeConfig({ skillLevel: 2 });
    const cfg = readConfig();
    expect(cfg.skillLevel).toBe(2);
    expect(cfg.telemetry).toBe(true);
    expect(cfg.telemetryInvite).toBe('dismissed');
  });

  it('merges telemetry without wiping skillLevel', () => {
    writeConfig({ skillLevel: 1 });
    writeConfig({ telemetry: false, telemetryInvite: 'dismissed' });
    const cfg = readConfig();
    expect(cfg.skillLevel).toBe(1);
    expect(cfg.telemetry).toBe(false);
    expect(cfg.telemetryInvite).toBe('dismissed');
  });
});
