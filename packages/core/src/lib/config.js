import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { userPaths } from './paths.js';
import { isValidSkillLevel, parseSkillLevel, SKILL_MAX, SKILL_MIN } from './skills.js';

const SCHEMA_VERSION = 2;

export function configFilePath() {
  return path.join(userPaths().config, 'config.json');
}

export function defaultConfig() {
  return { schemaVersion: SCHEMA_VERSION, skillLevel: null };
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
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  let skillLevel = raw.skillLevel === undefined ? null : raw.skillLevel;
  if (skillLevel != null) {
    // Migrate old 5 → expert(4)
    const n = Number(skillLevel);
    if (n === 5) skillLevel = 4;
  }
  return {
    schemaVersion: raw.schemaVersion ?? SCHEMA_VERSION,
    skillLevel,
  };
}

export function writeConfig(cfg) {
  const dir = userPaths().config;
  mkdirSync(dir, { recursive: true });
  const file = configFilePath();
  const data = {
    schemaVersion: SCHEMA_VERSION,
    skillLevel: cfg.skillLevel ?? null,
  };
  if (data.skillLevel !== null) {
    const n = typeof data.skillLevel === 'string'
      ? parseSkillLevel(data.skillLevel)
      : Number(data.skillLevel);
    if (!isValidSkillLevel(n)) {
      throw new Error(`skillLevel must be ${SKILL_MIN}–${SKILL_MAX} or null`);
    }
    data.skillLevel = n;
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows may ignore */
  }
  tightenWindowsAcl(file);
  return data;
}
