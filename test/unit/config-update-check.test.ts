import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  writeConfig,
  readConfig,
  CONFIG_SCHEMA_VERSION,
  defaultConfig,
} from '../../common/src/lib/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-config-v4');

describe('config updateCheck (schema v4)', () => {
  const saved = {};

  beforeEach(() => {
    for (const k of ['APPDATA', 'XDG_CONFIG_HOME', 'LOCALAPPDATA']) {
      saved[k] = process.env[k];
    }
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') {
      process.env.APPDATA = tmpRoot;
      process.env.LOCALAPPDATA = tmpRoot;
    } else {
      process.env.XDG_CONFIG_HOME = tmpRoot;
    }
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('defaultConfig includes updateCheck null and schema 4', () => {
    const d = defaultConfig();
    expect(d.schemaVersion).toBe(CONFIG_SCHEMA_VERSION);
    expect(CONFIG_SCHEMA_VERSION).toBe(4);
    expect(d.updateCheck).toBeNull();
  });

  it('round-trips updateCheck true/false', () => {
    writeConfig({ updateCheck: true });
    expect(readConfig().updateCheck).toBe(true);
    writeConfig({ updateCheck: false });
    expect(readConfig().updateCheck).toBe(false);
  });

  it('preserves telemetry when setting updateCheck', () => {
    writeConfig({ telemetry: true, telemetryInvite: 'dismissed' });
    writeConfig({ updateCheck: true });
    const cfg = readConfig();
    expect(cfg.telemetry).toBe(true);
    expect(cfg.updateCheck).toBe(true);
  });
});
