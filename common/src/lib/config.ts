// @ts-nocheck
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { userPaths } from './paths.js';
import { isValidSkillLevel, parseSkillLevel, SKILL_MAX, SKILL_MIN } from './skills.js';
import { parseJson, UserConfigSchema } from '../schemas/index.js';

export const CONFIG_SCHEMA_VERSION = 3;

export function configFilePath() {
  return path.join(userPaths().config, 'config.json');
}

export function defaultConfig() {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    skillLevel: null,
    telemetry: null,
    telemetryInvite: 'pending',
  };
}

/**
 * Refuse overly open permissions (POSIX mode or Windows ACL via icacls).
 * @param {string} file
 */
export function assertSecureConfigFile(file) {
  if (process.platform === 'win32') {
    let out = '';
    try {
      out = execFileSync('icacls', [file], { encoding: 'utf8' });
    } catch {
      const err = new Error('Config file ACL check failed; refusing to load');
      err.code = 'CONFIG_INSECURE';
      throw err;
    }
    // Broad group/world principals that should not read user config
    if (/Everyone:|(BUILTIN\\)?Users:|Authenticated Users:/i.test(out)) {
      const err = new Error('Config file is readable by other users; refusing to load');
      err.code = 'CONFIG_INSECURE';
      throw err;
    }
    return;
  }

  const mode = statSync(file).mode & 0o777;
  if (mode & 0o077) {
    const err = new Error('Config file is world/group readable; refusing to load');
    err.code = 'CONFIG_INSECURE';
    throw err;
  }
}

function windowsAccountName() {
  try {
    return execFileSync('whoami', { encoding: 'utf8' }).trim();
  } catch {
    const domain = process.env.USERDOMAIN;
    const user = process.env.USERNAME || process.env.USER;
    if (domain && user) return `${domain}\\${user}`;
    return user || '';
  }
}

function tightenWindowsAcl(file) {
  if (process.platform !== 'win32') return;
  const account = windowsAccountName();
  if (!account) return;
  try {
    execFileSync('icacls', [file, '/inheritance:r'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('icacls', [file, '/grant:r', `${account}:(F)`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    /* best-effort; assertSecureConfigFile will catch on next read */
  }
}

export function readConfig() {
  const file = configFilePath();
  if (!existsSync(file)) {
    return defaultConfig();
  }
  try {
    assertSecureConfigFile(file);
  } catch (e) {
    if (e.code === 'CONFIG_INSECURE' && process.platform === 'win32') {
      tightenWindowsAcl(file);
      assertSecureConfigFile(file);
    } else {
      throw e;
    }
  }
  const raw = parseJson(readFileSync(file, 'utf8'), UserConfigSchema);
  return {
    schemaVersion: raw.schemaVersion ?? CONFIG_SCHEMA_VERSION,
    skillLevel: raw.skillLevel ?? null,
    telemetry: raw.telemetry === true ? true : raw.telemetry === false ? false : null,
    telemetryInvite: raw.telemetryInvite === 'dismissed' ? 'dismissed' : 'pending',
  };
}

/**
 * Merge patch onto existing config and persist. Always preserves skill + telemetry fields.
 * @param {Partial<{ skillLevel: number|null, telemetry: boolean|null, telemetryInvite: string }>} patch
 */
export function writeConfig(patch = {}) {
  const dir = userPaths().config;
  mkdirSync(dir, { recursive: true });
  const file = configFilePath();
  const prev = existsSync(file) ? readConfig() : defaultConfig();
  const merged = {
    ...prev,
    ...patch,
    schemaVersion: CONFIG_SCHEMA_VERSION,
  };

  let skillLevel = merged.skillLevel ?? null;
  if (skillLevel !== null) {
    const n = typeof skillLevel === 'string'
      ? parseSkillLevel(skillLevel)
      : Number(skillLevel);
    if (!isValidSkillLevel(n)) {
      throw new Error(`skillLevel must be ${SKILL_MIN}–${SKILL_MAX} or null`);
    }
    skillLevel = n;
  }

  const telemetry =
    merged.telemetry === true ? true : merged.telemetry === false ? false : null;
  const telemetryInvite =
    merged.telemetryInvite === 'dismissed' ? 'dismissed' : 'pending';

  const data = {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    skillLevel,
    telemetry,
    telemetryInvite,
  };

  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows may ignore */
  }
  tightenWindowsAcl(file);
  return data;
}
