import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compareSemver,
  isUpdateCheckEnabled,
  isUpdateCacheFresh,
  checkForUpdate,
  maybeNotifyUpdate,
  setUpdateCheckEnabled,
  writeUpdateCache,
  readUpdateCache,
  updateInstallHint,
  UPDATE_CHECK_TTL_MS,
} from '../../common/src/lib/updateCheck.js';
import { writeConfig, readConfig } from '../../common/src/lib/config.js';
import { appVersion } from '../../common/src/lib/version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, '../.tmp-update-check');

describe('update-check', () => {
  const saved = {};

  beforeEach(() => {
    for (const k of [
      'APPDATA',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'LOCALAPPDATA',
      'GIT_GRASP_UPDATE_CHECK',
    ]) {
      saved[k] = process.env[k];
    }
    rmSync(tmpRoot, { recursive: true, force: true });
    mkdirSync(tmpRoot, { recursive: true });
    if (process.platform === 'win32') {
      process.env.APPDATA = tmpRoot;
      process.env.LOCALAPPDATA = tmpRoot;
    } else {
      process.env.XDG_CONFIG_HOME = tmpRoot;
      process.env.XDG_CACHE_HOME = tmpRoot;
    }
    delete process.env.GIT_GRASP_UPDATE_CHECK;
    writeConfig({ updateCheck: null });
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('compareSemver orders versions', () => {
    expect(compareSemver('0.2.0', '0.1.0')).toBe(1);
    expect(compareSemver('0.1.0', '0.2.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBe(-1);
  });

  it('disabled by default', () => {
    expect(isUpdateCheckEnabled(readConfig())).toBe(false);
  });

  it('GIT_GRASP_UPDATE_CHECK=0 hard-offs even when enabled', () => {
    setUpdateCheckEnabled(true);
    process.env.GIT_GRASP_UPDATE_CHECK = '0';
    expect(isUpdateCheckEnabled(readConfig())).toBe(false);
  });

  it('isUpdateCacheFresh respects TTL', () => {
    const fresh = { checkedAt: new Date().toISOString(), latest: '9.9.9', local: '0.1.0' };
    expect(isUpdateCacheFresh(fresh)).toBe(true);
    const stale = {
      checkedAt: new Date(Date.now() - UPDATE_CHECK_TTL_MS - 1000).toISOString(),
      latest: '9.9.9',
      local: '0.1.0',
    };
    expect(isUpdateCacheFresh(stale)).toBe(false);
  });

  it('checkForUpdate uses mock fetch when forced', async () => {
    setUpdateCheckEnabled(true);
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ version: '99.0.0' }),
    });
    const result = await checkForUpdate({ force: true, fetchImpl });
    expect(result.latest).toBe('99.0.0');
    expect(result.newer).toBe(true);
    expect(readUpdateCache()?.latest).toBe('99.0.0');
  });

  it('maybeNotifyUpdate is silent when disabled', async () => {
    const fetchImpl = async () => {
      throw new Error('should not fetch');
    };
    const out = await maybeNotifyUpdate({ fetchImpl, quiet: true });
    expect(out.notified).toBe(false);
  });

  it('checkForUpdate fails soft on network error', async () => {
    setUpdateCheckEnabled(true);
    const fetchImpl = async () => {
      throw new Error('offline');
    };
    const result = await checkForUpdate({ force: true, fetchImpl });
    expect(result.latest).toBeNull();
    expect(result.newer).toBe(false);
  });

  it('writeUpdateCache round-trips', () => {
    writeUpdateCache({ latest: '1.2.3', local: '1.0.0' });
    const c = readUpdateCache();
    expect(c.latest).toBe('1.2.3');
    expect(c.local).toBe('1.0.0');
    expect(c.checkedAt).toBeTruthy();
  });

  it('maybeNotifyUpdate prints a single whole-line warn with install command', async () => {
    setUpdateCheckEnabled(true);
    const local = appVersion();
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ version: '99.0.0' }),
    });
    const errSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const out = await maybeNotifyUpdate({ force: true, fetchImpl, quiet: false });
      expect(out.notified).toBe(true);
      expect(errSpy).toHaveBeenCalledTimes(1);
      const msg = String(errSpy.mock.calls[0][0]);
      expect(msg).toContain('99.0.0');
      expect(msg).toContain(local);
      expect(msg).toContain('bun add -g git-grasp@latest');
      expect(msg).not.toContain(EMOJI_WARN);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('updateInstallHint branches binary vs bun', () => {
    expect(updateInstallHint({ GIT_GRASP_INSTALL: 'bun' })).toMatch(/bun add -g/);
    expect(updateInstallHint({ GIT_GRASP_INSTALL: 'binary' })).toMatch(/release zip/i);
  });
});

const EMOJI_WARN = '⚠️';
