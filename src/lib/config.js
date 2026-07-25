import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import path from 'node:path';
import { userPaths } from './paths.js';

const SCHEMA_VERSION = 1;

export function configFilePath() {
  return path.join(userPaths().config, 'config.json');
}

export function defaultConfig() {
  return { schemaVersion: SCHEMA_VERSION, skillLevel: null };
}

export function readConfig() {
  const file = configFilePath();
  if (!existsSync(file)) {
    return defaultConfig();
  }
  if (process.platform !== 'win32') {
    const mode = statSync(file).mode & 0o777;
    if (mode & 0o077) {
      const err = new Error('Config file is world/group readable; refusing to load');
      err.code = 'CONFIG_INSECURE';
      throw err;
    }
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  return {
    schemaVersion: raw.schemaVersion ?? SCHEMA_VERSION,
    skillLevel: raw.skillLevel === undefined ? null : raw.skillLevel,
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
    const n = Number(data.skillLevel);
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      throw new Error('skillLevel must be 1–5 or null');
    }
    data.skillLevel = n;
  }
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* Windows may ignore */
  }
  return data;
}
